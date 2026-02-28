import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { historyHandler } from './history.handler.js';
import { TaskLogger } from '../../orchestrator/task.logger.js';
import { SnapshotManager } from '../../snapshots/snapshot.manager.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';
import type { TaskRun } from '@nightfall/shared';

let tmpDir: string;
let ctx: CommandDispatcherContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-history-'));
  ctx = {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: {} as CommandDispatcherContext['orchestrator'],
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper to write a source file ───────────────────────────────────────────

async function writeFile(relativePath: string, content: string): Promise<void> {
  const full = path.join(tmpDir, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

// ── Helper to create a task run log ─────────────────────────────────────────

async function createTaskRun(overrides: Partial<TaskRun> = {}): Promise<TaskRun> {
  const run: TaskRun = {
    id: 'task-001',
    prompt: 'add feature',
    plan: null,
    status: 'completed',
    reworkCycles: 0,
    agentStates: {},
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    snapshotId: null,
    ...overrides,
  };
  const logger = new TaskLogger(tmpDir);
  await logger.saveLog(run);
  return run;
}

// ── historyHandler — no args ─────────────────────────────────────────────────

describe('historyHandler — no args', () => {
  it('returns history_view JSON with empty lists when no history', async () => {
    const result = await historyHandler(ctx, '');
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('history_view');
    expect(parsed.runs).toEqual([]);
    expect(parsed.snapshots).toEqual([]);
  });

  it('returns history_view JSON including saved task runs', async () => {
    await createTaskRun({ id: 'task-001', prompt: 'add feature' });
    const result = await historyHandler(ctx, '');
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('history_view');
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].prompt).toBe('add feature');
  });

  it('includes snapshot list in history_view JSON', async () => {
    await writeFile('src/index.ts', 'export {}');
    const manager = new SnapshotManager(tmpDir);
    await manager.createSnapshot('task-001', 'add feature', ['src/index.ts']);

    const result = await historyHandler(ctx, '');
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('history_view');
    expect(parsed.snapshots).toHaveLength(1);
    expect(parsed.snapshots[0].prompt).toBe('add feature');
  });
});

// ── historyHandler — rollback <id> ───────────────────────────────────────────

describe('historyHandler — rollback <id>', () => {
  it('returns rollback_confirm JSON with the rollback chain', async () => {
    await writeFile('src/index.ts', 'export {}');
    const manager = new SnapshotManager(tmpDir);
    const snapshotId = await manager.createSnapshot('task-001', 'add feature', ['src/index.ts']);

    const result = await historyHandler(ctx, `rollback ${snapshotId}`);
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('rollback_confirm');
    expect(parsed.snapshotId).toBe(snapshotId);
    expect(Array.isArray(parsed.chain)).toBe(true);
    expect(parsed.chain.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error string (not JSON) for unknown snapshotId', async () => {
    const result = await historyHandler(ctx, 'rollback unknown-snap-id');
    expect(result).toContain('Snapshot not found');
    expect(() => JSON.parse(result)).toThrow();
  });

  it('returns error string for missing snapshotId', async () => {
    const result = await historyHandler(ctx, 'rollback');
    expect(result).toContain('Usage:');
    expect(() => JSON.parse(result)).toThrow();
  });
});

// ── historyHandler — rollback <id> confirm ───────────────────────────────────

describe('historyHandler — rollback <id> confirm', () => {
  it('restores files and returns plain text confirmation', async () => {
    await writeFile('src/index.ts', 'original content');
    const manager = new SnapshotManager(tmpDir);
    const snapshotId = await manager.createSnapshot('task-001', 'add feature', ['src/index.ts']);

    // Modify the file after snapshot
    await writeFile('src/index.ts', 'modified content');

    const result = await historyHandler(ctx, `rollback ${snapshotId} confirm`);
    expect(result).toContain('✓ Rollback complete');
    expect(result).toContain('src/index.ts');

    // Verify the file was actually restored
    const restored = await fs.readFile(path.join(tmpDir, 'src/index.ts'), 'utf-8');
    expect(restored).toBe('original content');
  });

  it('returns confirmation even when no files were restored', async () => {
    // Create a snapshot that captured no files that exist in the snapshot store
    const manager = new SnapshotManager(tmpDir);
    const snapshotId = await manager.createSnapshot('task-001', 'add feature', []);

    const result = await historyHandler(ctx, `rollback ${snapshotId} confirm`);
    expect(result).toContain('✓ Rollback complete');
  });

  it('returns error string for invalid snapshotId on confirm', async () => {
    const result = await historyHandler(ctx, 'rollback bad-id confirm');
    expect(result).toContain('Rollback failed');
    expect(() => JSON.parse(result)).toThrow();
  });
});
