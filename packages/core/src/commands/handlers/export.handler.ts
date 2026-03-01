import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskRun } from '@nightfall/shared';
import { TaskLogger } from '../../orchestrator/task.logger.js';
import { deriveProjectSlug } from '../../memory/memory.init.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(startedAt: number, completedAt: number | null): string {
  if (!completedAt) return 'ongoing';
  const secs = Math.round((completedAt - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function formatTokens(run: TaskRun): string {
  if (!run.tokenUsage) return 'n/a';
  return run.tokenUsage.totalTokens.toLocaleString();
}

function filesTouched(run: TaskRun): string[] {
  if (!run.plan) return [];
  return run.plan.subtasks.flatMap((s) => s.filesTouched ?? []);
}

function renderHistorySection(runs: TaskRun[]): string {
  if (runs.length === 0) {
    return '## Task History\n\n_No task history found._\n';
  }

  const lines: string[] = ['## Task History', ''];

  runs.forEach((run, i) => {
    const num = String(i + 1).padStart(3, '0');
    const date = new Date(run.startedAt).toISOString().replace('T', ' ').slice(0, 19);
    const desc = run.prompt.replace(/\n/g, ' ').trim();
    lines.push(`### Task ${num} — ${desc}`);
    lines.push('');
    lines.push(`- **Date:** ${date}`);
    lines.push(`- **Status:** ${run.status}`);
    lines.push(`- **Duration:** ${formatDuration(run.startedAt, run.completedAt)}`);
    lines.push(`- **Tokens:** ${formatTokens(run)}`);

    const files = filesTouched(run);
    if (files.length > 0) {
      lines.push(`- **Files changed:** ${files.join(', ')}`);
    }

    if (run.warnings && run.warnings.length > 0) {
      lines.push(`- **Warnings:** ${run.warnings.join('; ')}`);
    }

    lines.push('');
  });

  return lines.join('\n');
}

async function collectMemoryFiles(dir: string, relBase: string, depth = 0): Promise<string[]> {
  if (depth > 10) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (_err) {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = path.join(dir, entry);
    const rel = relBase ? `${relBase}/${entry}` : entry;
    let lstat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      lstat = await fs.lstat(fullPath);
    } catch (_err) {
      continue;
    }
    if (lstat.isSymbolicLink()) continue;
    if (lstat.isDirectory()) {
      const nested = await collectMemoryFiles(fullPath, rel, depth + 1);
      results.push(...nested);
    } else if (entry.endsWith('.md')) {
      results.push(rel);
    }
  }
  return results;
}

async function renderMemorySection(
  projectRoot: string,
  namespaceOverride?: string,
): Promise<string> {
  const namespace = namespaceOverride ?? (await deriveProjectSlug(projectRoot));
  const memoryDir = path.join(projectRoot, '.nightfall', 'memory', namespace);

  const mdFiles = await collectMemoryFiles(memoryDir, '');
  if (mdFiles.length === 0) {
    try {
      await fs.readdir(memoryDir);
      return '## Memory Bank\n\n_Memory bank is empty._\n';
    } catch (_err) {
      return '## Memory Bank\n\n_No memory bank found._\n';
    }
  }

  const lines: string[] = ['## Memory Bank', ''];

  for (const file of mdFiles.sort()) {
    lines.push(`### ${file}`);
    lines.push('');
    try {
      const content = await fs.readFile(path.join(memoryDir, file), 'utf-8');
      lines.push(content.trim());
    } catch (_err) {
      lines.push('_Could not read file._');
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * /export             → exports all history + memory to .nightfall/export-<timestamp>.md
 * /export --history   → history only
 * /export --memory    → memory only
 */
export async function exportHandler(ctx: CommandDispatcherContext, args: string): Promise<string> {
  const flags = args.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const includeHistory = flags.length === 0 || flags.includes('--history');
  const includeMemory = flags.length === 0 || flags.includes('--memory');

  const projectName = path.basename(ctx.projectRoot);
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d+Z$/, '');

  const sections: string[] = [`# Nightfall Export — ${projectName} — ${timestamp}`, ''];

  if (includeHistory) {
    const logger = new TaskLogger(ctx.projectRoot);
    const runs = await logger.listLogs();
    sections.push(renderHistorySection(runs));
  }

  if (includeMemory) {
    sections.push(await renderMemorySection(ctx.projectRoot, ctx.config.memoryNamespace));
  }

  const content = sections.join('\n');

  const nightfallDir = path.join(ctx.projectRoot, '.nightfall');
  await fs.mkdir(nightfallDir, { recursive: true });

  const filename = `export-${timestamp}.md`;
  const outputPath = path.join(nightfallDir, filename);
  await fs.writeFile(outputPath, content, 'utf-8');

  const rel = path.relative(ctx.projectRoot, outputPath);
  return `Export saved to ${rel}`;
}
