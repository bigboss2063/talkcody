import { Clock, FileText, Play, Terminal } from 'lucide-react';

interface BashToolResultProps {
  output?: string;
  outputFile?: string;
  error?: string;
  errorFile?: string;
  success: boolean;
  exitCode?: number;
  idleTimedOut?: boolean;
  timedOut?: boolean;
  pid?: number | null;
  taskId?: string;
  isBackground?: boolean;
}

export function BashToolResult({
  output,
  outputFile,
  error,
  errorFile,
  success,
  exitCode,
  idleTimedOut,
  timedOut,
  pid,
  taskId,
  isBackground,
}: BashToolResultProps) {
  const isSuccess = success || exitCode === 0;
  const isRunningInBackground = idleTimedOut || timedOut;
  const isExplicitBackground = isBackground && !isRunningInBackground;

  // Determine message based on success/failure and output
  let message = isSuccess ? 'Command executed successfully' : 'Command execution failed';
  if (!isSuccess && !output && !error) {
    message += ', no output';
  }

  const displayOutput = output || error || message;
  const hasOutputFile = outputFile || errorFile;
  const outputFilePath = outputFile || errorFile;

  return (
    <div className="space-y-3">
      {/* Background task indicator */}
      {isExplicitBackground && taskId && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 px-3 py-2 rounded-md">
          <Play className="h-4 w-4" />
          <span>
            Process running in background (Task ID: <code className="font-mono">{taskId}</code>)
          </span>
        </div>
      )}

      {/* Idle timeout / Timed out indicator */}
      {isRunningInBackground && (
        <div className="flex items-center gap-2 text-sm text-amber-500 bg-amber-500/10 px-3 py-2 rounded-md">
          {idleTimedOut ? (
            <>
              <Play className="h-4 w-4" />
              <span>Process running in background{pid ? ` (PID: ${pid})` : ''}</span>
            </>
          ) : (
            <>
              <Clock className="h-4 w-4" />
              <span>Command timed out{pid ? ` (PID: ${pid})` : ''}</span>
            </>
          )}
        </div>
      )}

      {/* Output display */}
      <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono border-l-4 border-gray-600 dark:bg-gray-950 dark:border-gray-700 w-full overflow-hidden">
        <div className="flex items-center gap-2 mb-3 text-sm">
          <Terminal className="h-4 w-4 text-gray-400 dark:text-gray-500" />
          <span className="text-gray-300 dark:text-gray-400">Output:</span>
        </div>
        <div className="bg-gray-800 px-3 py-2 rounded max-h-60 overflow-auto dark:bg-gray-900">
          <pre className="text-sm text-gray-100 whitespace-pre-wrap break-words dark:text-gray-200">
            {displayOutput}
          </pre>
        </div>
      </div>

      {/* Output file link */}
      {hasOutputFile && (
        <div className="flex items-center gap-2 text-sm text-amber-500 bg-amber-500/10 px-3 py-2 rounded-md">
          <FileText className="h-4 w-4" />
          <span>Full output saved to file ({outputFilePath})</span>
          {isExplicitBackground && (
            <span className="ml-auto text-xs">
              Use <code className="font-mono bg-amber-500/20 px-1 rounded">cat {outputFile}</code>{' '}
              to read
            </span>
          )}
        </div>
      )}
    </div>
  );
}
