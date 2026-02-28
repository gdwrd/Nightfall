import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SnapshotMeta } from '@nightfall/shared';

const SNAPSHOTS_DIR = '.nightfall/snapshots';

function zeroPad(num: number, width: number): string {
  return String(num).padStart(width, '0');
}

export class SnapshotManager {
  constructor(private projectRoot: string) {}

  private snapshotsDir(): string {
    return path.join(this.projectRoot, SNAPSHOTS_DIR);
  }

  private snapshotDir(snapshotId: string): string {
    return path.join(this.snapshotsDir(), snapshotId);
  }

  private metaPath(snapshotId: string): string {
    return path.join(this.snapshotDir(snapshotId), 'meta.json');
  }

  private filesDir(snapshotId: string): string {
    return path.join(this.snapshotDir(snapshotId), 'files');
  }

  /**
   * Determine the next sequence number by counting existing snapshots.
   */
  private async nextSequenceNum(): Promise<number> {
    const snapshots = await this.listSnapshots();
    return snapshots.length + 1;
  }

  /**
   * Create a snapshot of the given files before a task runs.
   * Copies each file to .nightfall/snapshots/<snapshotId>/files/<relativePath>
   * and writes meta.json with the SnapshotMeta shape.
   */
  async createSnapshot(taskId: string, prompt: string, filePaths: string[]): Promise<string> {
    const seq = await this.nextSequenceNum();
    const timestamp = Date.now();
    const snapshotId = `task_${zeroPad(seq, 3)}_${timestamp}`;

    const existing = await this.listSnapshots();
    const parentSnapshotId = existing.length > 0 ? existing[0].snapshotId : null;

    const snapshotFilesDir = this.filesDir(snapshotId);
    await fs.mkdir(snapshotFilesDir, { recursive: true });

    // Copy each file into the snapshot
    for (const filePath of filePaths) {
      const absoluteSrc = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.projectRoot, filePath);

      const relativePath = path.relative(this.projectRoot, absoluteSrc);
      const dest = path.join(snapshotFilesDir, relativePath);

      await fs.mkdir(path.dirname(dest), { recursive: true });

      try {
        await fs.copyFile(absoluteSrc, dest);
      } catch {
        // If the file doesn't exist yet (new file), skip copying
      }
    }

    const meta: SnapshotMeta = {
      snapshotId,
      taskId,
      prompt,
      timestamp,
      parentSnapshotId,
      filesChanged: filePaths.map((fp) =>
        path.isAbsolute(fp) ? path.relative(this.projectRoot, fp) : fp,
      ),
    };

    await fs.writeFile(this.metaPath(snapshotId), JSON.stringify(meta, null, 2), 'utf-8');

    return snapshotId;
  }

  /**
   * Retrieve metadata for a single snapshot.
   */
  async getSnapshot(snapshotId: string): Promise<SnapshotMeta> {
    const metaFile = this.metaPath(snapshotId);
    const content = await fs.readFile(metaFile, 'utf-8');
    return JSON.parse(content) as SnapshotMeta;
  }

  /**
   * List all snapshots sorted by timestamp descending (newest first).
   */
  async listSnapshots(): Promise<SnapshotMeta[]> {
    const dir = this.snapshotsDir();

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const snapshots: SnapshotMeta[] = [];

    for (const entry of entries) {
      const metaFile = path.join(dir, entry, 'meta.json');
      try {
        const content = await fs.readFile(metaFile, 'utf-8');
        snapshots.push(JSON.parse(content) as SnapshotMeta);
      } catch {
        // Skip directories without valid meta.json
      }
    }

    snapshots.sort((a, b) => b.timestamp - a.timestamp);
    return snapshots;
  }

  /**
   * Rollback to a specific snapshot, restoring all files from that snapshot
   * and removing all snapshots that came after it (cascade).
   * Returns the list of files that were restored.
   */
  async rollback(snapshotId: string): Promise<string[]> {
    const chain = await this.getRollbackChain(snapshotId);
    const restoredFiles: string[] = [];

    // Iterate the chain in reverse chronological order (newest first)
    for (const snap of chain) {
      const snapshotFilesDir = this.filesDir(snap.snapshotId);

      // Restore files from this snapshot
      for (const relativePath of snap.filesChanged) {
        const src = path.join(snapshotFilesDir, relativePath);
        const dest = path.join(this.projectRoot, relativePath);

        try {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(src, dest);
          if (!restoredFiles.includes(relativePath)) {
            restoredFiles.push(relativePath);
          }
        } catch {
          // File may not exist in snapshot (was a new file)
        }
      }

      // Delete the snapshot directory
      await fs.rm(this.snapshotDir(snap.snapshotId), { recursive: true, force: true });
    }

    return restoredFiles;
  }

  /**
   * Get the rollback chain: the target snapshot plus all snapshots
   * that came after it (those with timestamp > target.timestamp).
   * Returns them sorted newest-first (reverse chronological order).
   */
  async getRollbackChain(snapshotId: string): Promise<SnapshotMeta[]> {
    const target = await this.getSnapshot(snapshotId);
    const all = await this.listSnapshots();

    // Include target and all snapshots with timestamp >= target.timestamp
    const chain = all.filter((s) => s.timestamp >= target.timestamp);

    // Already sorted newest-first from listSnapshots
    return chain;
  }
}
