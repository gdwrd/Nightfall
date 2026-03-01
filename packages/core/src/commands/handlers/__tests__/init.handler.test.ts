import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHandler } from '../init.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';

let tmpDir: string;
let ctx: CommandDispatcherContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-init-'));
  ctx = {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: {} as CommandDispatcherContext['orchestrator'],
    provider: {} as CommandDispatcherContext['provider'],
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('initHandler', () => {
  describe('preview (no args)', () => {
    it('returns preview text listing files to be created', async () => {
      const result = await initHandler(ctx, '');
      expect(result).toContain('Memory bank preview');
      expect(result).toContain('index.md');
      expect(result).toContain('project.md');
      expect(result).toContain('tech.md');
      expect(result).toContain('patterns.md');
      expect(result).toContain('progress.md');
    });

    it('asks for confirmation', async () => {
      const result = await initHandler(ctx, '');
      expect(result).toContain('Type y to create or n to cancel');
    });

    it('does not create files during preview', async () => {
      await initHandler(ctx, '');
      const memDir = path.join(tmpDir, '.nightfall', 'memory');
      const exists = await fs.stat(memDir).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('shows files with descriptions', async () => {
      const result = await initHandler(ctx, '');
      expect(result).toContain('memory index');
    });
  });

  describe('confirm mode (args === "confirm")', () => {
    it('creates memory bank files and returns success message', async () => {
      const result = await initHandler(ctx, 'confirm');
      expect(result).toContain('Memory bank initialized');
      expect(result).toContain('.nightfall/memory/');
    });

    it('creates .nightfall/memory/ directory', async () => {
      await initHandler(ctx, 'confirm');
      const memDir = path.join(tmpDir, '.nightfall', 'memory');
      const stat = await fs.stat(memDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('lists created files in output', async () => {
      const result = await initHandler(ctx, 'confirm');
      expect(result).toContain('index.md');
    });

    it('shows checkmark on success', async () => {
      const result = await initHandler(ctx, 'confirm');
      expect(result).toContain('✓');
    });
  });

  describe('error handling', () => {
    it('returns error message when initialization fails', async () => {
      // Make projectRoot a file instead of a directory to force an error
      const filePath = path.join(tmpDir, 'not-a-dir');
      await fs.writeFile(filePath, 'content');
      const badCtx = { ...ctx, projectRoot: filePath };
      const result = await initHandler(badCtx, 'confirm');
      expect(result).toContain('Error during /init:');
    });
  });
});
