import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SnapshotManager } from './snapshot.manager.js';

let tmpDir: string;
let manager: SnapshotManager;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-snap-'));
  manager = new SnapshotManager(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper to write a file relative to the project root
async function writeFile(relativePath: string, content: string): Promise<void> {
  const full = path.join(tmpDir, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

// Helper to read a file relative to the project root
async function readFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(tmpDir, relativePath), 'utf-8');
}

// ─── createSnapshot ─────────────────────────────────────────────

describe('createSnapshot', () => {
  it('creates correct directory layout with files copied', async () => {
    await writeFile('src/index.ts', 'console.log("hello")');
    await writeFile('src/utils.ts', 'export const a = 1');

    const snapshotId = await manager.createSnapshot('task-1', 'add feature', [
      'src/index.ts',
      'src/utils.ts',
    ]);

    expect(snapshotId).toMatch(/^task_001_\d+$/);

    // Verify files were copied
    const snapshotDir = path.join(tmpDir, '.nightfall/snapshots', snapshotId, 'files');
    const copiedIndex = await fs.readFile(path.join(snapshotDir, 'src/index.ts'), 'utf-8');
    const copiedUtils = await fs.readFile(path.join(snapshotDir, 'src/utils.ts'), 'utf-8');

    expect(copiedIndex).toBe('console.log("hello")');
    expect(copiedUtils).toBe('export const a = 1');
  });

  it('writes meta.json with correct shape', async () => {
    await writeFile('src/index.ts', 'original');

    const snapshotId = await manager.createSnapshot('task-1', 'fix bug', ['src/index.ts']);

    const metaPath = path.join(tmpDir, '.nightfall/snapshots', snapshotId, 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    expect(meta.snapshotId).toBe(snapshotId);
    expect(meta.taskId).toBe('task-1');
    expect(meta.prompt).toBe('fix bug');
    expect(meta.timestamp).toBeTypeOf('number');
    expect(meta.parentSnapshotId).toBeNull();
    expect(meta.filesChanged).toEqual(['src/index.ts']);
  });

  it('sets parentSnapshotId to previous snapshot', async () => {
    await writeFile('src/a.ts', 'a');
    const firstId = await manager.createSnapshot('task-1', 'first', ['src/a.ts']);

    await writeFile('src/b.ts', 'b');
    const secondId = await manager.createSnapshot('task-2', 'second', ['src/b.ts']);

    const meta = await manager.getSnapshot(secondId);
    expect(meta.parentSnapshotId).toBe(firstId);
  });

  it('handles non-existent files gracefully (new file scenario)', async () => {
    const snapshotId = await manager.createSnapshot('task-1', 'new file', ['src/nonexistent.ts']);

    expect(snapshotId).toMatch(/^task_001_\d+$/);

    const meta = await manager.getSnapshot(snapshotId);
    expect(meta.filesChanged).toEqual(['src/nonexistent.ts']);
  });

  it('increments sequence number for each snapshot', async () => {
    await writeFile('src/a.ts', 'a');
    const id1 = await manager.createSnapshot('task-1', 'first', ['src/a.ts']);
    expect(id1).toMatch(/^task_001_/);

    await writeFile('src/b.ts', 'b');
    const id2 = await manager.createSnapshot('task-2', 'second', ['src/b.ts']);
    expect(id2).toMatch(/^task_002_/);

    await writeFile('src/c.ts', 'c');
    const id3 = await manager.createSnapshot('task-3', 'third', ['src/c.ts']);
    expect(id3).toMatch(/^task_003_/);
  });
});

// ─── getSnapshot ────────────────────────────────────────────────

describe('getSnapshot', () => {
  it('returns metadata for an existing snapshot', async () => {
    await writeFile('src/index.ts', 'content');
    const snapshotId = await manager.createSnapshot('task-1', 'test', ['src/index.ts']);

    const meta = await manager.getSnapshot(snapshotId);

    expect(meta.snapshotId).toBe(snapshotId);
    expect(meta.taskId).toBe('task-1');
    expect(meta.prompt).toBe('test');
    expect(meta.filesChanged).toEqual(['src/index.ts']);
  });

  it('throws when snapshot does not exist', async () => {
    await expect(manager.getSnapshot('nonexistent')).rejects.toThrow();
  });
});

// ─── listSnapshots ──────────────────────────────────────────────

describe('listSnapshots', () => {
  it('returns empty array when no snapshots exist', async () => {
    const snapshots = await manager.listSnapshots();
    expect(snapshots).toEqual([]);
  });

  it('returns all snapshots sorted by timestamp descending', async () => {
    await writeFile('src/a.ts', 'a');
    const id1 = await manager.createSnapshot('task-1', 'first', ['src/a.ts']);

    await writeFile('src/b.ts', 'b');
    const id2 = await manager.createSnapshot('task-2', 'second', ['src/b.ts']);

    await writeFile('src/c.ts', 'c');
    const id3 = await manager.createSnapshot('task-3', 'third', ['src/c.ts']);

    const snapshots = await manager.listSnapshots();

    expect(snapshots).toHaveLength(3);
    // Newest first
    expect(snapshots[0].snapshotId).toBe(id3);
    expect(snapshots[1].snapshotId).toBe(id2);
    expect(snapshots[2].snapshotId).toBe(id1);
  });
});

// ─── rollback ───────────────────────────────────────────────────

describe('rollback', () => {
  it('restores files to their snapshot state', async () => {
    await writeFile('src/index.ts', 'original content');
    const snapshotId = await manager.createSnapshot('task-1', 'modify file', ['src/index.ts']);

    // Simulate task modifying the file
    await writeFile('src/index.ts', 'modified content');
    expect(await readFile('src/index.ts')).toBe('modified content');

    // Rollback
    const restored = await manager.rollback(snapshotId);

    expect(restored).toContain('src/index.ts');
    expect(await readFile('src/index.ts')).toBe('original content');
  });

  it('removes the snapshot directory after rollback', async () => {
    await writeFile('src/a.ts', 'a');
    const snapshotId = await manager.createSnapshot('task-1', 'test', ['src/a.ts']);

    await manager.rollback(snapshotId);

    const snapshots = await manager.listSnapshots();
    expect(snapshots).toHaveLength(0);
  });

  it('cascades rollback to all later snapshots', async () => {
    await writeFile('src/a.ts', 'version 1');
    const id1 = await manager.createSnapshot('task-1', 'first change', ['src/a.ts']);

    await writeFile('src/a.ts', 'version 2');
    await manager.createSnapshot('task-2', 'second change', ['src/a.ts']);

    await writeFile('src/a.ts', 'version 3');
    await manager.createSnapshot('task-3', 'third change', ['src/a.ts']);

    // Rollback to the first snapshot — should cascade and remove snapshots 2 and 3
    const restored = await manager.rollback(id1);

    expect(restored).toContain('src/a.ts');
    expect(await readFile('src/a.ts')).toBe('version 1');

    const remaining = await manager.listSnapshots();
    expect(remaining).toHaveLength(0);
  });

  it('restores multiple files', async () => {
    await writeFile('src/a.ts', 'a-original');
    await writeFile('src/b.ts', 'b-original');

    const snapshotId = await manager.createSnapshot('task-1', 'multi file', [
      'src/a.ts',
      'src/b.ts',
    ]);

    await writeFile('src/a.ts', 'a-modified');
    await writeFile('src/b.ts', 'b-modified');

    await manager.rollback(snapshotId);

    expect(await readFile('src/a.ts')).toBe('a-original');
    expect(await readFile('src/b.ts')).toBe('b-original');
  });
});

// ─── getRollbackChain ───────────────────────────────────────────

describe('getRollbackChain', () => {
  it('returns only the target when it is the latest snapshot', async () => {
    await writeFile('src/a.ts', 'a');
    const snapshotId = await manager.createSnapshot('task-1', 'only one', ['src/a.ts']);

    const chain = await manager.getRollbackChain(snapshotId);

    expect(chain).toHaveLength(1);
    expect(chain[0].snapshotId).toBe(snapshotId);
  });

  it('includes all snapshots after the target', async () => {
    await writeFile('src/a.ts', 'a');
    const id1 = await manager.createSnapshot('task-1', 'first', ['src/a.ts']);

    await writeFile('src/b.ts', 'b');
    const id2 = await manager.createSnapshot('task-2', 'second', ['src/b.ts']);

    await writeFile('src/c.ts', 'c');
    const id3 = await manager.createSnapshot('task-3', 'third', ['src/c.ts']);

    const chain = await manager.getRollbackChain(id1);

    expect(chain).toHaveLength(3);
    // Newest first (reverse chronological)
    expect(chain[0].snapshotId).toBe(id3);
    expect(chain[1].snapshotId).toBe(id2);
    expect(chain[2].snapshotId).toBe(id1);
  });

  it('does not include snapshots before the target', async () => {
    await writeFile('src/a.ts', 'a');
    await manager.createSnapshot('task-1', 'first', ['src/a.ts']);

    await writeFile('src/b.ts', 'b');
    const id2 = await manager.createSnapshot('task-2', 'second', ['src/b.ts']);

    await writeFile('src/c.ts', 'c');
    const id3 = await manager.createSnapshot('task-3', 'third', ['src/c.ts']);

    const chain = await manager.getRollbackChain(id2);

    expect(chain).toHaveLength(2);
    expect(chain[0].snapshotId).toBe(id3);
    expect(chain[1].snapshotId).toBe(id2);
  });
});
