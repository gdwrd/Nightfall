import { TaskLogger } from '../../orchestrator/task.logger.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

export async function historyHandler(ctx: CommandDispatcherContext): Promise<string> {
  try {
    const logger = new TaskLogger(ctx.projectRoot);
    const runs = await logger.listLogs();
    if (runs.length === 0) return 'No task history found.';

    const lines = ['Recent tasks (newest first):', ''];
    for (const run of runs.slice(0, 10)) {
      const date = new Date(run.startedAt).toLocaleString();
      const duration = run.completedAt
        ? `${Math.round((run.completedAt - run.startedAt) / 1000)}s`
        : 'ongoing';
      const status = run.status === 'completed' ? '✓' : run.status === 'cancelled' ? '✗' : '!';
      const prompt = run.prompt.replace(/\n/g, ' ').trim();
      const truncated = prompt.length > 50 ? prompt.slice(0, 49) + '…' : prompt;
      lines.push(`  ${status} [${date}] ${truncated} (${duration})`);
    }
    return lines.join('\n');
  } catch {
    return 'Could not read task history.';
  }
}
