import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskRun } from '@nightfall/shared';

const LOGS_DIR = '.nightfall/logs';

function sanitizeFilename(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}

export class TaskLogger {
  constructor(private readonly projectRoot: string) {}

  private logsDir(): string {
    return path.join(this.projectRoot, LOGS_DIR);
  }

  /**
   * Persist a TaskRun to disk as a JSON log file.
   * Filename: <ISO timestamp>_<prompt-slug>.json
   */
  async saveLog(taskRun: TaskRun): Promise<void> {
    await fs.mkdir(this.logsDir(), { recursive: true });

    const date = new Date(taskRun.startedAt);
    // e.g. "2024-01-15T14-32-00"
    const iso = date
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\.\d+Z$/, '');
    const slug = sanitizeFilename(taskRun.prompt);
    const filename = `${iso}_${slug}.json`;

    await fs.writeFile(
      path.join(this.logsDir(), filename),
      JSON.stringify(taskRun, null, 2),
      'utf-8',
    );
  }

  /**
   * Load all task run logs, sorted newest first.
   */
  async listLogs(): Promise<TaskRun[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.logsDir());
    } catch {
      return [];
    }

    const logs: TaskRun[] = [];
    for (const entry of entries.filter((e) => e.endsWith('.json'))) {
      try {
        const content = await fs.readFile(path.join(this.logsDir(), entry), 'utf-8');
        logs.push(JSON.parse(content) as TaskRun);
      } catch {
        // Skip malformed log files
      }
    }

    logs.sort((a, b) => b.startedAt - a.startedAt);
    return logs;
  }

  /**
   * Delete old log files, keeping only the most recent `maxCount`.
   */
  async pruneOldLogs(maxCount: number): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.logsDir());
    } catch {
      return;
    }

    // Sort filenames ascending (oldest first by ISO timestamp prefix)
    const jsonEntries = entries.filter((e) => e.endsWith('.json')).sort();
    const toDelete = jsonEntries.slice(0, Math.max(0, jsonEntries.length - maxCount));

    for (const entry of toDelete) {
      await fs.unlink(path.join(this.logsDir(), entry)).catch(() => {});
    }
  }
}
