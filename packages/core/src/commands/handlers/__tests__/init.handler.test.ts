import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initHandler } from '../init.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';

let tmpDir: string;
let ctx: CommandDispatcherContext;

// Minimal provider mock — yields a <done> signal so the memory-manager agent
// terminates immediately without looping, while analyzeAndProposeInit still
// gets an empty fileMap (no === file === sections present).
function makeProvider() {
  return {
    complete: async function* () {
      yield '<done>\n{"summary": "Memory bank initialized for testing"}\n</done>';
    },
  };
}

// Minimal orchestrator mock — emit and on are no-ops
function makeOrchestrator() {
  return { emit: () => false, on: () => ({}) };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-init-'));
  ctx = {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: makeOrchestrator() as unknown as CommandDispatcherContext['orchestrator'],
    provider: makeProvider() as unknown as CommandDispatcherContext['provider'],
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('initHandler', () => {
  describe('preview (no args)', () => {
    it('returns proposal text listing files to be created', async () => {
      const result = await initHandler(ctx, '');
      expect(result).toContain('Memory bank proposal');
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
      const exists = await fs
        .stat(memDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('confirm mode (args === "confirm")', () => {
    beforeEach(async () => {
      // Populate the pending cache by running the preview step first
      await initHandler(ctx, '');
    });

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

    it('includes namespace subdirectory path in output', async () => {
      const result = await initHandler(ctx, 'confirm');
      // Output format: "✓ Memory bank initialized in .nightfall/memory/<namespace>/"
      expect(result).toMatch(/\.nightfall\/memory\/.+\//);
    });

    it('shows checkmark on success', async () => {
      const result = await initHandler(ctx, 'confirm');
      expect(result).toContain('✓');
    });

    it('returns "No pending init" if confirm called without prior /init', async () => {
      // Different project root — nothing cached for it
      const otherCtx = { ...ctx, projectRoot: path.join(tmpDir, 'other') };
      const result = await initHandler(otherCtx, 'confirm');
      expect(result).toContain('No pending init found');
    });
  });

  describe('error handling', () => {
    it('returns error message when project root is not a directory', async () => {
      // analyzeAndProposeInit calls scanProject which does readdir — fails on a file path
      const filePath = path.join(tmpDir, 'not-a-dir');
      await fs.writeFile(filePath, 'content');
      const badCtx = { ...ctx, projectRoot: filePath };
      const result = await initHandler(badCtx, '');
      expect(result).toContain('Error during /init:');
    });
  });
});
