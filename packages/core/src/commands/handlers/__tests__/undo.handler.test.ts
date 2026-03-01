import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { undoHandler } from '../undo.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';

let tmpDir: string;
let ctx: CommandDispatcherContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-undo-'));
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

async function createSnapshot(
  snapshotId: string,
  taskId: string,
  prompt: string,
  timestamp: number,
  filesChanged: string[] = [],
): Promise<void> {
  const snapshotDir = path.join(tmpDir, '.nightfall', 'snapshots', snapshotId);
  const filesDir = path.join(snapshotDir, 'files');
  await fs.mkdir(filesDir, { recursive: true });

  const meta = { snapshotId, taskId, prompt, timestamp, parentSnapshotId: null, filesChanged };
  await fs.writeFile(path.join(snapshotDir, 'meta.json'), JSON.stringify(meta), 'utf-8');

  // Write dummy versions of the snapshotted files
  for (const relativePath of filesChanged) {
    const dest = path.join(filesDir, relativePath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, `snapshot content of ${relativePath}`, 'utf-8');
  }
}

describe('undoHandler', () => {
  describe('no snapshots available', () => {
    it('returns "No snapshots available to undo."', async () => {
      const result = await undoHandler(ctx, '');
      expect(result).toBe('No snapshots available to undo.');
    });
  });

  describe('rolling back the latest snapshot (no args)', () => {
    beforeEach(async () => {
      await createSnapshot('task_001_1000', 'task-001', 'Fix the bug', 1000, ['src/foo.ts']);
      await createSnapshot('task_002_2000', 'task-002', 'Add a feature', 2000, ['src/bar.ts']);
    });

    it('rolls back the most recent snapshot', async () => {
      // Create the actual file so rollback can restore it
      const srcFile = path.join(tmpDir, 'src', 'bar.ts');
      await fs.mkdir(path.dirname(srcFile), { recursive: true });
      await fs.writeFile(srcFile, 'original content', 'utf-8');

      const result = await undoHandler(ctx, '');
      expect(result).toContain('✓');
      expect(result).toContain('Add a feature');
    });

    it('includes restored file list', async () => {
      const srcFile = path.join(tmpDir, 'src', 'bar.ts');
      await fs.mkdir(path.dirname(srcFile), { recursive: true });
      await fs.writeFile(srcFile, 'original content', 'utf-8');

      const result = await undoHandler(ctx, '');
      expect(result).toContain('src/bar.ts');
    });

    it('removes the rolled-back snapshot after rollback', async () => {
      const srcFile = path.join(tmpDir, 'src', 'bar.ts');
      await fs.mkdir(path.dirname(srcFile), { recursive: true });
      await fs.writeFile(srcFile, 'original content', 'utf-8');

      await undoHandler(ctx, '');

      const snapshotsDir = path.join(tmpDir, '.nightfall', 'snapshots');
      const remaining = await fs.readdir(snapshotsDir);
      expect(remaining).not.toContain('task_002_2000');
    });
  });

  describe('rolling back by task ID', () => {
    beforeEach(async () => {
      await createSnapshot('task_001_1000', 'task-abc', 'First task', 1000, ['src/a.ts']);
      await createSnapshot('task_002_2000', 'task-xyz', 'Second task', 2000, ['src/b.ts']);
    });

    it('finds snapshot by taskId', async () => {
      const srcFile = path.join(tmpDir, 'src', 'a.ts');
      await fs.mkdir(path.dirname(srcFile), { recursive: true });
      await fs.writeFile(srcFile, 'original', 'utf-8');

      const result = await undoHandler(ctx, 'task-abc');
      expect(result).toContain('First task');
    });

    it('finds snapshot by snapshotId', async () => {
      const srcFile = path.join(tmpDir, 'src', 'a.ts');
      await fs.mkdir(path.dirname(srcFile), { recursive: true });
      await fs.writeFile(srcFile, 'original', 'utf-8');

      const result = await undoHandler(ctx, 'task_001_1000');
      expect(result).toContain('First task');
    });

    it('returns error when task ID not found', async () => {
      const result = await undoHandler(ctx, 'nonexistent-id');
      expect(result).toContain('No snapshot found for task ID: nonexistent-id');
    });
  });

  describe('snapshot with no files changed', () => {
    beforeEach(async () => {
      await createSnapshot('task_001_1000', 'task-001', 'Empty task', 1000, []);
    });

    it('reports no files were restored', async () => {
      const result = await undoHandler(ctx, '');
      expect(result).toContain('No files were restored');
    });
  });

  describe('long prompt truncation', () => {
    beforeEach(async () => {
      const longPrompt = 'A'.repeat(100);
      await createSnapshot('task_001_1000', 'task-001', longPrompt, 1000, []);
    });

    it('truncates the prompt to 60 chars with ellipsis', async () => {
      const result = await undoHandler(ctx, '');
      // The quoted portion should not exceed ~62 characters (60 + ellipsis)
      expect(result).toContain('…');
      const match = result.match(/"(.+?)"/);
      expect(match).not.toBeNull();
      if (match) {
        expect(match[1].length).toBeLessThanOrEqual(61);
      }
    });
  });
});
