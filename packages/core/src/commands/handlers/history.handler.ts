import { TaskLogger } from '../../orchestrator/task.logger.js';
import { SnapshotManager } from '../../snapshots/snapshot.manager.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

export async function historyHandler(ctx: CommandDispatcherContext, args: string): Promise<string> {
  const trimmedArgs = args.trim();

  // /history rollback <snapshotId> confirm — perform the rollback
  if (trimmedArgs.startsWith('rollback ') && trimmedArgs.endsWith(' confirm')) {
    const middle = trimmedArgs.slice('rollback '.length, trimmedArgs.length - ' confirm'.length).trim();
    if (!middle) return 'Invalid rollback command. Usage: /history rollback <snapshotId> confirm';

    try {
      const manager = new SnapshotManager(ctx.projectRoot);
      const restoredFiles = await manager.rollback(middle);
      if (restoredFiles.length === 0) {
        return '✓ Rollback complete. No files were restored.';
      }
      return `✓ Rollback complete. Restored:\n${restoredFiles.map((f) => `  ${f}`).join('\n')}`;
    } catch (err) {
      return `Rollback failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // /history rollback (no id) — show usage
  if (trimmedArgs === 'rollback') {
    return 'Usage: /history rollback <snapshotId>';
  }

  // /history rollback <snapshotId> — return chain info for confirmation
  if (trimmedArgs.startsWith('rollback ')) {
    const snapshotId = trimmedArgs.slice('rollback '.length).trim();
    if (!snapshotId) return 'Usage: /history rollback <snapshotId>';

    try {
      const manager = new SnapshotManager(ctx.projectRoot);
      const chain = await manager.getRollbackChain(snapshotId);
      return JSON.stringify({ type: 'rollback_confirm', chain, snapshotId });
    } catch (err) {
      return `Snapshot not found: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // /history (no args) — return full task list + snapshot list as JSON
  try {
    const logger = new TaskLogger(ctx.projectRoot);
    const manager = new SnapshotManager(ctx.projectRoot);
    const [runs, snapshots] = await Promise.all([logger.listLogs(), manager.listSnapshots()]);
    return JSON.stringify({ type: 'history_view', runs, snapshots });
  } catch {
    return 'Could not read task history.';
  }
}
