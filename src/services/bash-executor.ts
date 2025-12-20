import { invoke } from '@tauri-apps/api/core';
import { isAbsolute, join } from '@tauri-apps/api/path';
import { logger } from '@/lib/logger';
import { isPathWithinProjectDirectory } from '@/lib/utils/path-security';
import { taskFileService } from '@/services/task-file-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

// Result from Rust backend execute_user_shell command
interface TauriShellResult {
  stdout: string;
  stderr: string;
  code: number;
  timed_out: boolean;
  idle_timed_out: boolean;
  pid: number | null;
}

export interface BashResult {
  success: boolean;
  message: string;
  command: string;
  output?: string; // Short output (inline return)
  outputFile?: string; // Output file path (used when > 100 lines)
  error?: string; // Short error message
  errorFile?: string; // Error output file path (used when > 100 lines)
  exit_code?: number;
  timed_out?: boolean;
  idle_timed_out?: boolean;
  pid?: number | null;
  taskId?: string; // Background task ID if running in background
  isBackground?: boolean; // Whether command is running in background
}

// List of dangerous command patterns that should be blocked
// Note: rm -rf is NOT blocked here - it's validated by validateRmCommand() which checks:
// 1. Workspace root exists
// 2. Directory is inside a Git repository
// 3. All target paths are within workspace
const DANGEROUS_PATTERNS = [
  // File system destruction - rm patterns that are always dangerous
  /\brm\s+.*\*/, // rm with wildcards
  /\brm\b.*\s\.(?:\/)?(?:\s|$)/, // rm . or rm -rf . (current directory)
  /rmdir\s+.*-.*r/, // rmdir with recursive

  // Other file deletion commands
  /\bunlink\s+/,
  /\bshred\s+/,
  /\btruncate\s+.*-s\s*0/, // truncate to zero

  // find + delete combinations
  /\bfind\s+.*-delete/,
  /\bfind\s+.*-exec\s+rm/,
  /\bfind\s+.*\|\s*xargs\s+rm/,

  // File content clearing
  /^>\s*\S+/, // > file (clear file)
  /cat\s+\/dev\/null\s*>/, // cat /dev/null > file

  // Git dangerous operations
  /\bgit\s+clean\s+-[fd]/,
  /\bgit\s+reset\s+--hard/,

  // mv to dangerous locations
  /\bmv\s+.*\/dev\/null/,

  // Format commands (disk formatting, not code formatters)
  /mkfs\./,
  /\bformat\s+[a-zA-Z]:/, // Windows format drive command (format C:, format D:, etc.)
  /fdisk/,
  /parted/,
  /gparted/,

  // System control
  /shutdown/,
  /reboot/,
  /halt/,
  /poweroff/,
  /init\s+[016]/,

  // Dangerous dd operations
  /dd\s+.*of=\/dev/,

  // Permission changes that could be dangerous
  /chmod\s+.*777\s+\//,
  /chmod\s+.*-R.*777/,
  /chown\s+.*-R.*root/,

  // Network and system modification
  /iptables/,
  /ufw\s+.*disable/,
  /systemctl\s+.*stop/,
  /service\s+.*stop/,

  // Package managers with dangerous operations
  /apt\s+.*purge/,
  /yum\s+.*remove/,
  /brew\s+.*uninstall.*--force/,

  // Disk operations
  /mount\s+.*\/dev/,
  /umount\s+.*-f/,
  /fsck\s+.*-y/,

  // Process killing
  /killall\s+.*-9/,
  /pkill\s+.*-9.*init/,

  // Cron modifications
  /crontab\s+.*-r/,

  // History manipulation
  /history\s+.*-c/,
  />\s*~\/\.bash_history/,

  // Dangerous redirections
  />\s*\/dev\/sd[a-z]/,
  />\s*\/dev\/nvme/,
  />\s*\/etc\//,

  // Kernel and system files
  /modprobe\s+.*-r/,
  /insmod/,
  /rmmod/,

  // Dangerous curl/wget operations
  /curl\s+.*\|\s*(sh|bash|zsh)/,
  /wget\s+.*-O.*\|\s*(sh|bash|zsh)/,
];

// Additional dangerous commands (exact matches)
const DANGEROUS_COMMANDS = [
  'dd',
  'mkfs',
  'fdisk',
  'parted',
  'gparted',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'su',
  'sudo su',
  'unlink',
  'shred',
  'truncate',
];

/**
 * BashExecutor - handles bash command execution with safety checks
 */
export class BashExecutor {
  private readonly logger = logger;

  /**
   * Extract command parts excluding heredoc content
   * Heredoc syntax: << DELIMITER or <<- DELIMITER or << 'DELIMITER' or << "DELIMITER"
   * Content between << DELIMITER and DELIMITER should not be checked as commands
   * But commands AFTER the heredoc delimiter MUST be checked
   */
  private extractCommandExcludingHeredocContent(command: string): string {
    // Match heredoc start: << or <<- followed by optional quotes and delimiter
    const heredocMatch = command.match(/<<-?\s*['"]?(\w+)['"]?/);
    if (!heredocMatch) {
      return command;
    }

    const delimiter = heredocMatch[1];
    const heredocStartIndex = command.indexOf('<<');

    // Get the part before heredoc
    const beforeHeredoc = command.slice(0, heredocStartIndex);

    // Find the end of heredoc (delimiter on its own line)
    // The delimiter must be at the start of a line (after newline) and may have trailing whitespace
    const afterHeredocStart = command.slice(heredocStartIndex + heredocMatch[0].length);
    const delimiterPattern = new RegExp(`\\n${delimiter}\\s*(?:\\n|$)`);
    const delimiterMatch = afterHeredocStart.match(delimiterPattern);

    if (!delimiterMatch || delimiterMatch.index === undefined) {
      // No closing delimiter found, only check the part before heredoc
      return beforeHeredoc;
    }

    // Get commands after the heredoc delimiter
    const afterHeredoc = afterHeredocStart.slice(delimiterMatch.index + delimiterMatch[0].length);

    // Recursively process in case there are more heredocs
    const processedAfter = this.extractCommandExcludingHeredocContent(afterHeredoc);

    return `${beforeHeredoc} ${processedAfter}`;
  }

  /**
   * Check if a command is dangerous
   */
  private isDangerousCommand(command: string): {
    dangerous: boolean;
    reason?: string;
  } {
    // Extract command excluding heredoc content - heredoc content should not be checked
    // but commands after heredoc must still be checked
    const commandToCheck = this.extractCommandExcludingHeredocContent(command);
    const trimmedCommand = commandToCheck.trim().toLowerCase();

    // Check for exact dangerous commands
    for (const dangerousCmd of DANGEROUS_COMMANDS) {
      if (trimmedCommand.startsWith(`${dangerousCmd} `) || trimmedCommand === dangerousCmd) {
        return {
          dangerous: true,
          reason: `Command "${dangerousCmd}" is not allowed for security reasons`,
        };
      }
    }

    // Check for dangerous patterns (use commandToCheck to exclude heredoc content)
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(commandToCheck)) {
        return {
          dangerous: true,
          reason: 'Command matches dangerous pattern and is not allowed for security reasons',
        };
      }
    }

    // Check for multiple command chaining with dangerous commands
    // Only split on actual command separators: && || ;
    // Don't split on single | as it's used in sed patterns and pipes
    // Use commandToCheck to avoid splitting heredoc content
    if (
      commandToCheck.includes('&&') ||
      commandToCheck.includes('||') ||
      commandToCheck.includes(';')
    ) {
      const parts = commandToCheck.split(/\s*(?:&&|\|\||;)\s*/);
      for (const part of parts) {
        const partCheck = this.isDangerousCommand(part.trim());
        if (partCheck.dangerous) {
          return partCheck;
        }
      }
    }

    return { dangerous: false };
  }

  /**
   * Extract paths from rm command
   * Returns an array of paths that the rm command targets
   */
  private extractRmPaths(command: string): string[] {
    // Match rm command with optional flags
    // rm [-options] path1 [path2 ...]
    const rmMatch = command.match(/\brm\s+(.+)/);
    if (!rmMatch) {
      return [];
    }

    const args = rmMatch[1] ?? '';
    const paths: string[] = [];

    // Split by spaces, but respect quoted strings
    const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

    for (const part of parts) {
      // Skip flags (start with -)
      if (part.startsWith('-')) {
        continue;
      }
      // Remove surrounding quotes if present
      const cleanPath = part.replace(/^["']|["']$/g, '');
      if (cleanPath) {
        paths.push(cleanPath);
      }
    }

    return paths;
  }

  /**
   * Check if a path is within the workspace directory
   */
  private async isPathWithinWorkspace(targetPath: string, workspaceRoot: string): Promise<boolean> {
    // If the path is relative, it's relative to the workspace
    const isAbs = await isAbsolute(targetPath);
    if (!isAbs) {
      // Relative paths are allowed, but we need to resolve them first to check for ../ escapes
      const resolvedPath = await join(workspaceRoot, targetPath);
      return await isPathWithinProjectDirectory(resolvedPath, workspaceRoot);
    }

    // Check if the absolute path is within the workspace
    return await isPathWithinProjectDirectory(targetPath, workspaceRoot);
  }

  /**
   * Check if the command contains rm and validate the paths
   * Returns error message if rm is not allowed, null if allowed
   */
  private async validateRmCommand(
    command: string,
    workspaceRoot: string | null
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if command contains rm (excluding heredoc content)
    const commandToCheck = this.extractCommandExcludingHeredocContent(command);

    // Simple check for rm command presence
    if (!/\brm\b/.test(commandToCheck)) {
      return { allowed: true };
    }

    // If no workspace root is set, rm is not allowed
    if (!workspaceRoot) {
      return {
        allowed: false,
        reason: 'rm command is not allowed: no workspace root is set',
      };
    }

    // Check if workspace is a git repository by checking for .git directory
    try {
      const result = await invoke<TauriShellResult>('execute_user_shell', {
        command: 'git rev-parse --is-inside-work-tree',
        cwd: workspaceRoot,
        timeoutMs: 5000,
      });

      if (result.code !== 0 || result.stdout.trim() !== 'true') {
        return {
          allowed: false,
          reason: 'rm command is only allowed in git repositories',
        };
      }
    } catch {
      return {
        allowed: false,
        reason: 'rm command is only allowed in git repositories (git check failed)',
      };
    }

    // Extract and validate paths from rm command
    // Need to check each part of the command that might contain rm
    const commandParts = commandToCheck.split(/\s*(?:&&|\|\||;)\s*/);

    for (const part of commandParts) {
      const trimmedPart = part.trim();
      if (!/\brm\b/.test(trimmedPart)) {
        continue;
      }

      const paths = this.extractRmPaths(trimmedPart);

      if (paths.length === 0) {
        // rm without paths is likely an error, let it through and shell will handle it
        continue;
      }

      for (const targetPath of paths) {
        const isWithin = await this.isPathWithinWorkspace(targetPath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: path "${targetPath}" is outside the workspace directory`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Execute a bash command safely
   * @param command - The bash command to execute
   * @param taskId - The task ID for workspace root resolution
   * @param toolUseId - Optional tool use ID for output file naming
   */
  async execute(command: string, taskId: string, toolId: string): Promise<BashResult> {
    try {
      // Safety check
      const dangerCheck = this.isDangerousCommand(command);
      if (dangerCheck.dangerous) {
        this.logger.warn('Blocked dangerous command:', command);
        return {
          success: false,
          command,
          message: `Command blocked: ${dangerCheck.reason}`,
          error: dangerCheck.reason,
        };
      }

      this.logger.info('Executing bash command:', command);
      const rootPath = await getEffectiveWorkspaceRoot(taskId);

      // Validate rm command paths
      const rmValidation = await this.validateRmCommand(command, rootPath || null);
      if (!rmValidation.allowed) {
        this.logger.warn('Blocked rm command:', command, rmValidation.reason);
        return {
          success: false,
          command,
          message: `Command blocked: ${rmValidation.reason}`,
          error: rmValidation.reason,
        };
      }
      if (rootPath) {
        this.logger.info('rootPath:', rootPath);
      } else {
        this.logger.info('No rootPath set, executing in default directory');
      }

      // Execute command
      const result = await this.executeCommand(command, rootPath || null);
      this.logger.info('Command result:', result);

      // Generate tool use ID if not provided or empty
      const effectiveToolUseId = toolId?.trim()
        ? toolId.trim()
        : `bash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      return this.formatResult(result, command, taskId, effectiveToolUseId);
    } catch (error) {
      return this.handleError(error, command);
    }
  }

  /**
   * Execute command via Tauri backend
   * @param command - The command to execute
   * @param cwd - Working directory
   * @param timeoutMs - Maximum timeout in milliseconds (default: 120000 = 2 minutes)
   * @param idleTimeoutMs - Idle timeout in milliseconds (default: 5000 = 5 seconds)
   */
  private async executeCommand(
    command: string,
    cwd: string | null,
    timeoutMs?: number,
    idleTimeoutMs?: number
  ): Promise<TauriShellResult> {
    return await invoke<TauriShellResult>('execute_user_shell', {
      command,
      cwd,
      timeoutMs,
      idleTimeoutMs,
    });
  }

  /**
   * Format execution result
   * - Output > 100 lines: write to file, return file path
   * - Output <= 100 lines: return inline (truncated to 1000 lines as safety)
   */
  private async formatResult(
    result: TauriShellResult,
    command: string,
    taskId: string,
    toolUseId: string
  ): Promise<BashResult> {
    const isSuccess = result.idle_timed_out || result.timed_out || result.code === 0;

    let message: string;
    let output: string | undefined;
    let outputFile: string | undefined;
    let error: string | undefined;
    let errorFile: string | undefined;

    if (result.idle_timed_out) {
      message = `Command running in background (idle timeout after 5s). PID: ${result.pid ?? 'unknown'}`;
    } else if (result.timed_out) {
      message = `Command timed out after max timeout. PID: ${result.pid ?? 'unknown'}`;
    } else if (result.code === 0) {
      message = 'Command executed successfully';
    } else {
      message = `Command failed with exit code ${result.code}`;
    }

    // Process stdout
    if (result.stdout?.trim()) {
      const processed = await this.processOutput(result.stdout, taskId, toolUseId, 'stdout');
      output = processed.inline;
      outputFile = processed.file;
    }

    // Process stderr
    if (result.stderr?.trim()) {
      const processed = await this.processOutput(result.stderr, taskId, toolUseId, 'error');
      error = processed.inline;
      errorFile = processed.file;
    }

    return {
      success: isSuccess,
      command,
      message,
      output,
      outputFile,
      error,
      errorFile,
      exit_code: result.code,
      timed_out: result.timed_out,
      idle_timed_out: result.idle_timed_out,
      pid: result.pid,
    };
  }

  /**
   * Process output: write to file if large, otherwise return inline
   */
  private async processOutput(
    content: string,
    taskId: string,
    toolUseId: string,
    type: 'stdout' | 'error'
  ): Promise<{ inline?: string; file?: string }> {
    if (!content.trim()) {
      return {};
    }

    if (this.shouldWriteToFile(content)) {
      try {
        const filePath = await taskFileService.saveOutput(taskId, toolUseId, content, type);
        return { file: filePath };
      } catch (fileError) {
        this.logger.error(`Failed to write ${type} to file, keeping inline:`, fileError);
        return { inline: this.truncateOutput(content, 1000) };
      }
    }

    return { inline: this.truncateOutput(content, 1000) };
  }

  /**
   * Truncate output to last N lines
   */
  private truncateOutput(stdout: string, maxLines: number): string | undefined {
    if (!stdout.trim()) {
      return undefined;
    }
    const lines = stdout.split('\n');
    if (lines.length > maxLines) {
      return `... (${lines.length - maxLines} lines truncated)\n${lines.slice(-maxLines).join('\n')}`;
    }
    return stdout;
  }

  /**
   * Count the number of lines in text (optimized to avoid large array allocation)
   */
  private countLines(text: string): number {
    if (!text.trim()) return 0;
    let count = 1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') count++;
    }
    return count;
  }

  /**
   * Check if text should be written to file based on line count
   */
  private shouldWriteToFile(text: string): boolean {
    return this.countLines(text) > 100;
  }

  /**
   * Handle execution errors
   */
  private handleError(error: unknown, command: string): BashResult {
    this.logger.error('Error executing bash command:', error);
    return {
      success: false,
      command,
      message: 'Error executing bash command',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Execute a bash command in the background
   * @param command - The bash command to execute
   * @param taskId - The task ID for workspace root resolution
   * @param toolId - Optional tool use ID for output file naming
   * @param maxTimeoutMs - Optional timeout in milliseconds (default: 2 hours)
   */
  async executeInBackground(
    command: string,
    taskId: string,
    toolId: string,
    maxTimeoutMs?: number
  ): Promise<BashResult> {
    try {
      // Safety check
      const dangerCheck = this.isDangerousCommand(command);
      if (dangerCheck.dangerous) {
        this.logger.warn('Blocked dangerous command:', command);
        return {
          success: false,
          command,
          message: `Command blocked: ${dangerCheck.reason}`,
          error: dangerCheck.reason,
        };
      }

      this.logger.info('Executing background bash command:', command);
      const rootPath = await getEffectiveWorkspaceRoot(taskId);

      // Validate rm command paths
      const rmValidation = await this.validateRmCommand(command, rootPath || null);
      if (!rmValidation.allowed) {
        this.logger.warn('Blocked rm command:', command, rmValidation.reason);
        return {
          success: false,
          command,
          message: `Command blocked: ${rmValidation.reason}`,
          error: rmValidation.reason,
        };
      }

      // Import the background task store dynamically to avoid circular dependency
      const { useBackgroundTaskStore } = await import('@/stores/background-task-store');

      // Generate effective tool use ID
      const effectiveToolUseId = toolId?.trim()
        ? toolId.trim()
        : `bash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Spawn the background task
      const taskIdResult = await useBackgroundTaskStore
        .getState()
        .spawnTask(command, taskId, effectiveToolUseId, rootPath || undefined, maxTimeoutMs);

      this.logger.info('Background task spawned:', taskIdResult);

      return {
        success: true,
        command,
        message: `Command started in background (Task ID: ${taskIdResult})`,
        pid: undefined, // Will be available after first status refresh
        taskId: taskIdResult,
        isBackground: true,
      };
    } catch (error) {
      this.logger.error('Error executing background bash command:', error);
      return {
        success: false,
        command,
        message: 'Error executing background bash command',
        error: error instanceof Error ? error.message : String(error),
        isBackground: true,
      };
    }
  }
}

// Export singleton instance for convenience
export const bashExecutor = new BashExecutor();
