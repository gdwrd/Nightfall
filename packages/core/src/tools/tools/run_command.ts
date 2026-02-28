import { spawn } from 'node:child_process';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

/** AbortSignal used for task-level interruption. Set via setAbortSignal before calling. */
let _signal: AbortSignal | null = null;

export function setRunCommandAbortSignal(signal: AbortSignal | null): void {
  _signal = signal;
}

export const runCommandTool: ToolImpl = {
  definition: {
    name: 'run_command',
    description: 'Execute a shell command and return its stdout/stderr output.',
    parameters: {
      command: {
        type: 'string',
        description: 'Shell command to run.',
        required: true,
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command. Defaults to the project root.',
        required: false,
      },
      timeoutMs: {
        type: 'number',
        description: `Timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}. Max: ${MAX_TIMEOUT_MS}.`,
        required: false,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = String(params['command'] ?? '').trim();
    if (!command) {
      return {
        tool: 'run_command',
        success: false,
        output: '',
        error: 'Missing required parameter: command',
      };
    }

    const cwd = params['cwd'] ? String(params['cwd']) : ctx.projectRoot;
    const rawTimeout =
      params['timeoutMs'] != null ? Number(params['timeoutMs']) : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(rawTimeout, 0), MAX_TIMEOUT_MS);

    const signal = _signal;

    return new Promise<ToolResult>((resolve) => {
      if (signal?.aborted) {
        resolve({
          tool: 'run_command',
          success: false,
          output: '',
          error: 'Aborted before execution',
        });
        return;
      }

      const proc = spawn(command, { shell: true, cwd });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;

      const killProc = () => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killProc();
      }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        killProc();
      };
      signal?.addEventListener('abort', onAbort);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      let finished = false;
      const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);

        if (aborted) {
          resolve({
            tool: 'run_command',
            success: false,
            output: '',
            error: 'Command aborted by task interrupt',
          });
          return;
        }

        const combined = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        const truncated = truncateOutput(combined);
        const success = !timedOut && code === 0;

        let error: string | undefined;
        if (timedOut) error = `Command timed out after ${timeoutMs}ms`;
        else if (code !== 0) error = `Exit code ${code}`;

        resolve({ tool: 'run_command', success, output: truncated, error });
      };

      // Use 'exit' (fires when process exits) rather than 'close' (fires when all
      // I/O streams have been flushed). This ensures we resolve promptly even
      // when the process is killed and streams take time to drain.
      proc.on('exit', (code) => finish(code));
      // 'close' as fallback in case 'exit' is not emitted (shouldn't happen normally)
      proc.on('close', (code) => finish(code));

      proc.on('error', (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ tool: 'run_command', success: false, output: '', error: err.message });
      });
    });
  },
};

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const HEAD = 2_000;
  const TAIL = MAX_OUTPUT_CHARS - HEAD;
  const omitted = output.length - HEAD - TAIL;
  return `${output.slice(0, HEAD)}\n[... ${omitted} bytes omitted ...]\n${output.slice(-TAIL)}`;
}
