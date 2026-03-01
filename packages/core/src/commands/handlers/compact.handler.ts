import type { CompactionResult } from '@nightfall/shared';
import { MemoryManager } from '../../memory/memory.manager.js';
import { deriveProjectSlug } from '../../memory/memory.init.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

export async function compactHandler(ctx: CommandDispatcherContext): Promise<string> {
  const namespace = ctx.config.memoryNamespace ?? (await deriveProjectSlug(ctx.projectRoot));
  const manager = new MemoryManager(ctx.projectRoot, namespace);
  const results = await manager.compactAll(ctx.provider);

  if (results.length === 0) {
    return '⚠ No memory files found to compact.';
  }

  return formatCompactionSummary(results);
}

function formatCompactionSummary(results: CompactionResult[]): string {
  const totalBefore = results.reduce((s, r) => s + r.before, 0);
  const totalAfter = results.reduce((s, r) => s + r.after, 0);
  const totalRemoved = results.reduce((s, r) => s + r.removed, 0);

  const fileColWidth = Math.max(4, ...results.map((r) => r.file.length));
  const header = `${'FILE'.padEnd(fileColWidth)}  ${'BEFORE'.padStart(7)}  ${'AFTER'.padStart(7)}  ${'REMOVED'.padStart(7)}`;
  const separator = '\u2500'.repeat(header.length);
  const rows = results.map(
    (r) =>
      `${r.file.padEnd(fileColWidth)}  ${String(r.before).padStart(7)}  ${String(r.after).padStart(7)}  ${String(r.removed).padStart(7)}`,
  );
  const total = `${'TOTAL'.padEnd(fileColWidth)}  ${String(totalBefore).padStart(7)}  ${String(totalAfter).padStart(7)}  ${String(totalRemoved).padStart(7)}`;

  return [
    `✓ Compacted ${results.length} file${results.length === 1 ? '' : 's'}.`,
    '',
    header,
    separator,
    ...rows,
    separator,
    total,
  ].join('\n');
}
