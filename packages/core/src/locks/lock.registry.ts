import { EventEmitter } from 'node:events';
import type { FileLock } from '@nightfall/shared';

export interface LockRegistryOptions {
  deadlockTimeoutMs?: number;
  watcherIntervalMs?: number;
}

export class LockRegistry extends EventEmitter {
  private locks: Map<string, FileLock> = new Map();
  private readonly deadlockTimeoutMs: number;
  private readonly watcherIntervalMs: number;
  private watcherTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LockRegistryOptions = {}) {
    super();
    this.deadlockTimeoutMs = options.deadlockTimeoutMs ?? 30_000;
    this.watcherIntervalMs = options.watcherIntervalMs ?? 5_000;
    this.startDeadlockWatcher();
  }

  /**
   * Acquire a lock on a file path for a given agent.
   * If already locked by the same agent, resolves immediately.
   * If locked by another agent, polls with exponential backoff (100ms → 2s).
   */
  async acquireLock(path: string, agentId: string): Promise<void> {
    let delay = 100;

    while (true) {
      const existing = this.locks.get(path);

      if (!existing || existing.lockedBy === agentId) {
        const lock: FileLock = { path, lockedBy: agentId, lockedAt: Date.now() };
        this.locks.set(path, lock);
        this.emit('lock_acquired', lock);
        return;
      }

      // Wait and retry with exponential backoff, capped at 2s
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 2_000);
    }
  }

  /**
   * Release a lock on a file path.
   * Throws if agentId doesn't match the current holder.
   */
  releaseLock(path: string, agentId: string): void {
    const existing = this.locks.get(path);

    if (!existing) {
      throw new Error(`No lock found for path: ${path}`);
    }

    if (existing.lockedBy !== agentId) {
      throw new Error(
        `Lock on "${path}" is held by agent "${existing.lockedBy}", not "${agentId}"`,
      );
    }

    this.locks.delete(path);
    this.emit('lock_released', { path, lockedBy: agentId });
  }

  /**
   * Returns a snapshot of all currently held locks.
   */
  getLocks(): FileLock[] {
    return Array.from(this.locks.values());
  }

  /**
   * Release all locks held by a specific agent (e.g., on agent cancellation).
   */
  releaseAllLocksFor(agentId: string): void {
    for (const [path, lock] of this.locks) {
      if (lock.lockedBy === agentId) {
        this.locks.delete(path);
        this.emit('lock_released', { path, lockedBy: agentId });
      }
    }
  }

  /**
   * Stop the deadlock watcher. Call this when shutting down.
   */
  destroy(): void {
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
    this.removeAllListeners();
  }

  /**
   * Periodically check for locks held longer than deadlockTimeoutMs.
   * Auto-releases them and emits 'lock_deadlock'.
   */
  private startDeadlockWatcher(): void {
    this.watcherTimer = setInterval(() => {
      const now = Date.now();

      for (const [path, lock] of this.locks) {
        if (now - lock.lockedAt > this.deadlockTimeoutMs) {
          this.locks.delete(path);
          this.emit('lock_deadlock', { path, lockedBy: lock.lockedBy });
        }
      }
    }, this.watcherIntervalMs);

    // Allow the process to exit even if the watcher is running
    if (this.watcherTimer.unref) {
      this.watcherTimer.unref();
    }
  }
}
