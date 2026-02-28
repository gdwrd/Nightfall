import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LockRegistry } from './lock.registry.js';

let registry: LockRegistry;

beforeEach(() => {
  vi.useFakeTimers();
  registry = new LockRegistry({
    deadlockTimeoutMs: 5_000,
    watcherIntervalMs: 1_000,
  });
});

afterEach(() => {
  registry.destroy();
  vi.useRealTimers();
});

// ─── acquireLock / releaseLock ─────────────────────────────────

describe('acquireLock', () => {
  it('acquires a lock on an unlocked path', async () => {
    await registry.acquireLock('src/index.ts', 'agent-1');

    const locks = registry.getLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0].path).toBe('src/index.ts');
    expect(locks[0].lockedBy).toBe('agent-1');
    expect(locks[0].lockedAt).toBeTypeOf('number');
  });

  it('emits lock_acquired event', async () => {
    const handler = vi.fn();
    registry.on('lock_acquired', handler);

    await registry.acquireLock('src/index.ts', 'agent-1');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/index.ts', lockedBy: 'agent-1' }),
    );
  });

  it('allows same agent to re-acquire its own lock', async () => {
    await registry.acquireLock('src/index.ts', 'agent-1');
    await registry.acquireLock('src/index.ts', 'agent-1');

    const locks = registry.getLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0].lockedBy).toBe('agent-1');
  });

  it('allows different agents to lock different paths', async () => {
    await registry.acquireLock('src/a.ts', 'agent-1');
    await registry.acquireLock('src/b.ts', 'agent-2');

    const locks = registry.getLocks();
    expect(locks).toHaveLength(2);
  });

  it('second agent waits when path is locked by another agent', async () => {
    await registry.acquireLock('src/index.ts', 'agent-1');

    let secondAcquired = false;
    const secondPromise = registry.acquireLock('src/index.ts', 'agent-2').then(() => {
      secondAcquired = true;
    });

    // Advance past a few polling intervals — lock is still held
    await vi.advanceTimersByTimeAsync(300);
    expect(secondAcquired).toBe(false);

    // Release the lock
    registry.releaseLock('src/index.ts', 'agent-1');

    // Advance timers so the polling loop detects the release
    await vi.advanceTimersByTimeAsync(2_000);
    await secondPromise;

    expect(secondAcquired).toBe(true);
    const locks = registry.getLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0].lockedBy).toBe('agent-2');
  });
});

// ─── releaseLock ───────────────────────────────────────────────

describe('releaseLock', () => {
  it('releases a held lock', async () => {
    await registry.acquireLock('src/index.ts', 'agent-1');
    registry.releaseLock('src/index.ts', 'agent-1');

    expect(registry.getLocks()).toHaveLength(0);
  });

  it('emits lock_released event', async () => {
    const handler = vi.fn();
    registry.on('lock_released', handler);

    await registry.acquireLock('src/index.ts', 'agent-1');
    registry.releaseLock('src/index.ts', 'agent-1');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/index.ts', lockedBy: 'agent-1' }),
    );
  });

  it('throws when no lock exists for the path', () => {
    expect(() => registry.releaseLock('nonexistent.ts', 'agent-1')).toThrow(
      'No lock found for path: nonexistent.ts',
    );
  });

  it('throws when agentId does not match the lock holder', async () => {
    await registry.acquireLock('src/index.ts', 'agent-1');

    expect(() => registry.releaseLock('src/index.ts', 'agent-2')).toThrow(
      'Lock on "src/index.ts" is held by agent "agent-1", not "agent-2"',
    );
  });
});

// ─── getLocks ──────────────────────────────────────────────────

describe('getLocks', () => {
  it('returns an empty array when no locks are held', () => {
    expect(registry.getLocks()).toEqual([]);
  });

  it('returns a snapshot of all active locks', async () => {
    await registry.acquireLock('a.ts', 'agent-1');
    await registry.acquireLock('b.ts', 'agent-2');
    await registry.acquireLock('c.ts', 'agent-1');

    const locks = registry.getLocks();
    expect(locks).toHaveLength(3);

    const paths = locks.map((l) => l.path).sort();
    expect(paths).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

// ─── releaseAllLocksFor ────────────────────────────────────────

describe('releaseAllLocksFor', () => {
  it('releases all locks held by a specific agent', async () => {
    await registry.acquireLock('a.ts', 'agent-1');
    await registry.acquireLock('b.ts', 'agent-1');
    await registry.acquireLock('c.ts', 'agent-2');

    registry.releaseAllLocksFor('agent-1');

    const locks = registry.getLocks();
    expect(locks).toHaveLength(1);
    expect(locks[0].lockedBy).toBe('agent-2');
  });

  it('emits lock_released for each freed lock', async () => {
    const handler = vi.fn();
    registry.on('lock_released', handler);

    await registry.acquireLock('a.ts', 'agent-1');
    await registry.acquireLock('b.ts', 'agent-1');

    registry.releaseAllLocksFor('agent-1');

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does nothing when agent holds no locks', () => {
    expect(() => registry.releaseAllLocksFor('nonexistent')).not.toThrow();
    expect(registry.getLocks()).toHaveLength(0);
  });
});

// ─── deadlock watcher ──────────────────────────────────────────

describe('deadlock watcher', () => {
  it('auto-releases locks older than deadlockTimeoutMs', async () => {
    await registry.acquireLock('stale.ts', 'agent-1');

    // Advance past the deadlock timeout + watcher interval
    vi.advanceTimersByTime(6_000);

    expect(registry.getLocks()).toHaveLength(0);
  });

  it('emits lock_deadlock event for auto-released locks', async () => {
    const handler = vi.fn();
    registry.on('lock_deadlock', handler);

    await registry.acquireLock('stale.ts', 'agent-1');

    vi.advanceTimersByTime(6_000);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'stale.ts', lockedBy: 'agent-1' }),
    );
  });

  it('does not release locks within the timeout window', async () => {
    await registry.acquireLock('recent.ts', 'agent-1');

    // Advance less than the timeout
    vi.advanceTimersByTime(3_000);

    expect(registry.getLocks()).toHaveLength(1);
  });

  it('releases multiple stale locks in one sweep', async () => {
    await registry.acquireLock('a.ts', 'agent-1');
    await registry.acquireLock('b.ts', 'agent-2');

    vi.advanceTimersByTime(6_000);

    expect(registry.getLocks()).toHaveLength(0);
  });
});

// ─── destroy ───────────────────────────────────────────────────

describe('destroy', () => {
  it('stops the deadlock watcher', async () => {
    await registry.acquireLock('file.ts', 'agent-1');

    registry.destroy();

    // Advance past timeout — lock should NOT be auto-released because watcher is stopped
    vi.advanceTimersByTime(10_000);

    // getLocks still works but watcher didn't clean up
    expect(registry.getLocks()).toHaveLength(1);
  });
});
