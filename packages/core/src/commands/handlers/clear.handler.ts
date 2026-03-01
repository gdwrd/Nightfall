import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

export async function clearHandler(ctx: CommandDispatcherContext): Promise<string> {
  const logsDir = path.join(ctx.projectRoot, '.nightfall', 'logs');

  // Clear in-memory state first so it's always consistent regardless of disk errors.
  ctx.orchestrator.clearHistory();

  let deleted = 0;
  let failed = 0;
  try {
    const entries = await fs.readdir(logsDir);
    const jsonFiles = entries.filter((e) => e.endsWith('.json'));
    const results = await Promise.allSettled(
      jsonFiles.map((f) => fs.unlink(path.join(logsDir, f))),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        deleted++;
      } else {
        failed++;
      }
    }
  } catch (err) {
    // Ignore only ENOENT — logs directory does not exist, nothing to clear.
    // Any other error (e.g. readdir permission failure) propagates.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  if (deleted === 0 && failed === 0) return 'Task history cleared.';
  if (failed > 0) {
    return `Task history cleared. ${deleted} log file${deleted === 1 ? '' : 's'} removed; ${failed} could not be deleted.`;
  }
  return `Task history cleared. ${deleted} log file${deleted === 1 ? '' : 's'} removed.`;
}
