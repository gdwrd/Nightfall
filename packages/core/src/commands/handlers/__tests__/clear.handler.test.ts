import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { clearHandler } from '../clear.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';

let tmpDir: string;
let clearHistoryCalled: boolean;
let ctx: CommandDispatcherContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-clear-'));
  clearHistoryCalled = false;
  ctx = {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: {
      clearHistory: () => { clearHistoryCalled = true; },
    } as unknown as CommandDispatcherContext['orchestrator'],
    provider: {} as CommandDispatcherContext['provider'],
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function createLogFile(name: string, content = '{}'): Promise<void> {
  const logsDir = path.join(tmpDir, '.nightfall', 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(path.join(logsDir, name), content, 'utf8');
}

describe('clearHandler', () => {
  describe('logs directory does not exist', () => {
    it('returns "Task history cleared." with no count', async () => {
      const result = await clearHandler(ctx);
      expect(result).toBe('Task history cleared.');
    });

    it('still calls orchestrator.clearHistory()', async () => {
      await clearHandler(ctx);
      expect(clearHistoryCalled).toBe(true);
    });
  });

  describe('with log files', () => {
    beforeEach(async () => {
      await createLogFile('task-001.json');
      await createLogFile('task-002.json');
      await createLogFile('task-003.json');
    });

    it('deletes all .json log files', async () => {
      await clearHandler(ctx);
      const logsDir = path.join(tmpDir, '.nightfall', 'logs');
      const remaining = await fs.readdir(logsDir);
      const jsonFiles = remaining.filter((f) => f.endsWith('.json'));
      expect(jsonFiles).toHaveLength(0);
    });

    it('returns cleared count in message', async () => {
      const result = await clearHandler(ctx);
      expect(result).toContain('3');
      expect(result).toContain('removed');
    });

    it('calls orchestrator.clearHistory()', async () => {
      await clearHandler(ctx);
      expect(clearHistoryCalled).toBe(true);
    });

    it('uses plural "files" for multiple files', async () => {
      const result = await clearHandler(ctx);
      expect(result).toContain('log files removed');
    });
  });

  describe('with a single log file', () => {
    beforeEach(async () => {
      await createLogFile('task-001.json');
    });

    it('returns cleared count of 1', async () => {
      const result = await clearHandler(ctx);
      expect(result).toContain('1');
    });

    it('uses singular "file" for one file', async () => {
      const result = await clearHandler(ctx);
      expect(result).toContain('log file removed');
      expect(result).not.toMatch(/log files removed/);
    });
  });

  describe('non-json files in logs directory', () => {
    beforeEach(async () => {
      await createLogFile('task-001.json');
      const logsDir = path.join(tmpDir, '.nightfall', 'logs');
      await fs.writeFile(path.join(logsDir, 'README.txt'), 'not a log');
    });

    it('only deletes .json files', async () => {
      await clearHandler(ctx);
      const logsDir = path.join(tmpDir, '.nightfall', 'logs');
      const remaining = await fs.readdir(logsDir);
      expect(remaining).toContain('README.txt');
      expect(remaining).not.toContain('task-001.json');
    });

    it('returns count of json files only', async () => {
      const result = await clearHandler(ctx);
      expect(result).toContain('1');
    });
  });
});
