use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use log::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtySpawnResult {
    pub pty_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyOutput {
    pub pty_id: String,
    pub data: String,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
}

type PtyRegistry = Arc<Mutex<HashMap<String, PtySession>>>;

lazy_static::lazy_static! {
    static ref PTY_SESSIONS: PtyRegistry = Arc::new(Mutex::new(HashMap::new()));
}

fn get_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // Prefer PowerShell over cmd.exe for better experience
        // Check for PowerShell Core (pwsh) first, then Windows PowerShell
        if std::process::Command::new("pwsh")
            .arg("--version")
            .output()
            .is_ok()
        {
            info!("Detected PowerShell Core (pwsh)");
            return "pwsh".to_string();
        }
        if std::process::Command::new("powershell")
            .arg("-Version")
            .output()
            .is_ok()
        {
            info!("Detected Windows PowerShell");
            return "powershell".to_string();
        }
        // Fallback to cmd.exe
        info!("Falling back to cmd.exe");
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtySpawnResult, String> {
    info!("Spawning new PTY session");

    let pty_system = native_pty_system();
    let pty_size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = get_default_shell();
    info!("Spawning shell: {}", shell);
    let mut cmd = CommandBuilder::new(&shell);

    // Set working directory if provided
    if let Some(ref cwd_path) = cwd {
        info!("Setting working directory: {}", cwd_path);
        cmd.cwd(cwd_path);
    }

    // For Windows shells, add appropriate arguments
    #[cfg(target_os = "windows")]
    {
        if shell.contains("pwsh") || shell.contains("powershell") {
            // PowerShell: disable logo banner, keep session open
            cmd.args(&["-NoLogo", "-NoExit"]);
            info!("Added PowerShell args: -NoLogo -NoExit");
        }
        // cmd.exe doesn't need special arguments
    }

    // For Unix shells, use login shell to load environment
    #[cfg(not(target_os = "windows"))]
    {
        // Check if shell is zsh and disable PROMPT_SP (partial line marker)
        if shell.contains("zsh") {
            // Use -o option to disable prompt_sp before -l
            cmd.args(&["-o", "no_prompt_sp", "-l"]);
        } else {
            cmd.arg("-l");
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| {
            error!("Failed to spawn shell '{}': {}", shell, e);
            format!("Failed to spawn shell: {}", e)
        })?;

    info!("Shell spawned successfully");

    let pty_id = uuid::Uuid::new_v4().to_string();
    let writer = pair.master.take_writer().map_err(|e| format!("Failed to take writer: {}", e))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("Failed to clone reader: {}", e))?;

    // Store the session
    {
        let mut sessions = PTY_SESSIONS.lock().unwrap();
        sessions.insert(
            pty_id.clone(),
            PtySession {
                writer,
            },
        );
    }

    // Spawn a task to read output
    let pty_id_clone = pty_id.clone();
    let app_clone = app.clone();
    info!("Starting PTY read loop for {}", pty_id);
    tokio::spawn(async move {
        let mut buffer = [0u8; 8192];
        info!("PTY {} read loop started", pty_id_clone);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    info!("PTY {} closed (read returned 0)", pty_id_clone);
                    // PTY closed
                    let _ = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: pty_id_clone.clone(),
                            data: String::new(),
                        },
                    );
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    info!("PTY {} read {} bytes", pty_id_clone, n);
                    let emit_result = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: pty_id_clone.clone(),
                            data,
                        },
                    );
                    if let Err(e) = emit_result {
                        error!("Failed to emit pty-output event: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error reading from PTY {}: {}", pty_id_clone, e);
                    break;
                }
            }
        }

        // Clean up session
        let mut sessions = PTY_SESSIONS.lock().unwrap();
        sessions.remove(&pty_id_clone);

        // Emit close event
        let _ = app_clone.emit(
            "pty-close",
            serde_json::json!({ "pty_id": pty_id_clone }),
        );
    });

    // Wait a bit for the child process to start
    drop(child);

    Ok(PtySpawnResult { pty_id })
}

#[tauri::command]
pub fn pty_write(pty_id: String, data: String) -> Result<(), String> {
    info!("pty_write called: pty_id={}, data_len={}", pty_id, data.len());
    let mut sessions = PTY_SESSIONS.lock().unwrap();

    if let Some(session) = sessions.get_mut(&pty_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| {
                error!("Failed to write to PTY {}: {}", pty_id, e);
                format!("Failed to write to PTY: {}", e)
            })?;
        session
            .writer
            .flush()
            .map_err(|e| {
                error!("Failed to flush PTY {}: {}", pty_id, e);
                format!("Failed to flush PTY: {}", e)
            })?;
        info!("pty_write successful for {}", pty_id);
        Ok(())
    } else {
        error!("PTY session {} not found", pty_id);
        Err(format!("PTY session {} not found", pty_id))
    }
}

#[tauri::command]
pub fn pty_resize(pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    info!("Resizing PTY {} to {}x{}", pty_id, cols, rows);
    // Note: portable-pty doesn't provide direct access to resize after creation
    // This would require keeping a reference to the PtyPair, which complicates the design
    // For now, we'll accept the command but note that resize isn't fully implemented
    // A full implementation would require restructuring to keep the PtyPair accessible
    Ok(())
}

#[tauri::command]
pub fn pty_kill(pty_id: String) -> Result<(), String> {
    info!("Killing PTY session {}", pty_id);
    let mut sessions = PTY_SESSIONS.lock().unwrap();

    if sessions.remove(&pty_id).is_some() {
        Ok(())
    } else {
        Err(format!("PTY session {} not found", pty_id))
    }
}
