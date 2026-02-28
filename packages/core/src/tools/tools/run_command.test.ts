import { describe, it, expect, afterEach } from 'vitest';
import { runCommandTool, setRunCommandAbortSignal } from './run_command.js';
import type { ToolContext } from '../tool.types.js';

const ctx = (): ToolContext => ({
  agentId: 'engineer-1',
  role: 'engineer',
  projectRoot: '/tmp',
});

afterEach(() => {
  setRunCommandAbortSignal(null);
});

describe('run_command tool', () => {
  it('should run a successful command and return stdout', async () => {
    const result = await runCommandTool.execute({ command: 'echo hello' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('should capture non-zero exit code as failure', async () => {
    const result = await runCommandTool.execute({ command: 'exit 1' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exit code 1/i);
  });

  it('should respect timeout and report it', async () => {
    const result = await runCommandTool.execute({ command: 'sleep 10', timeoutMs: 100 }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  }, 5_000);

  it('should abort when AbortSignal fires', async () => {
    const controller = new AbortController();
    setRunCommandAbortSignal(controller.signal);

    // Start a slow command and abort it immediately
    const promise = runCommandTool.execute({ command: 'sleep 5' }, ctx());
    controller.abort();

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abort/i);
  }, 5_000);

  it('should truncate output longer than 8000 chars', async () => {
    // Generate ~10k chars of output
    const result = await runCommandTool.execute(
      { command: 'python3 -c "print(\'x\' * 10000)"' },
      ctx(),
    );
    if (result.success) {
      // Output may or may not be truncated depending on system
      const combined = result.output;
      expect(combined.length).toBeLessThanOrEqual(8_200); // some slack for the truncation message
    }
  });

  it('should return error when command is missing', async () => {
    const result = await runCommandTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });
});
