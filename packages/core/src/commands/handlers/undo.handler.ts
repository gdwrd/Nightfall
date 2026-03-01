import { SnapshotManager } from '../../snapshots/snapshot.manager.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

/**
 * /undo            — rolls back the most recent completed task's snapshot
 * /undo <task-id>  — rolls back a specific task by task ID
 */
export async function undoHandler(ctx: CommandDispatcherContext, args: string): Promise<string> {
  const manager = new SnapshotManager(ctx.projectRoot);
  const rollbackErrors: string[] = [];
  manager.on('snapshot:error', ({ error }) => {
    rollbackErrors.push(error);
  });

  const snapshots = await manager.listSnapshots();

  if (snapshots.length === 0) {
    return 'No snapshots available to undo.';
  }

  const taskId = args.trim();

  let targetSnapshot = snapshots[0]; // newest first — default to latest

  if (taskId) {
    // Find snapshot by task ID
    const match = snapshots.find((s) => s.taskId === taskId || s.snapshotId === taskId);
    if (!match) {
      return `No snapshot found for task ID: ${taskId}`;
    }
    targetSnapshot = match;
  }

  try {
    const restoredFiles = await manager.rollback(targetSnapshot.snapshotId);
    const prompt =
      targetSnapshot.prompt.length > 60
        ? targetSnapshot.prompt.slice(0, 59) + '…'
        : targetSnapshot.prompt;

    const lines: string[] = [];

    if (restoredFiles.length === 0) {
      lines.push(`✓ Rolled back "${prompt}". No files were restored.`);
    } else {
      lines.push(
        `✓ Rolled back "${prompt}".`,
        `Restored ${restoredFiles.length} file${restoredFiles.length === 1 ? '' : 's'}:`,
        ...restoredFiles.map((f) => `  ${f}`),
      );
    }

    if (rollbackErrors.length > 0) {
      lines.push(
        '',
        `⚠ ${rollbackErrors.length} error${rollbackErrors.length === 1 ? '' : 's'} during rollback:`,
      );
      for (const e of rollbackErrors) {
        lines.push(`  ${e}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `Rollback failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
