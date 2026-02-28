import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

const DEFAULT_AGENTS = ['team-lead', 'engineer', 'reviewer', 'memory-manager'];

export async function agentsHandler(ctx: CommandDispatcherContext): Promise<string> {
  const overridesDir = path.join(ctx.projectRoot, '.nightfall', '.agents');

  let overrides: Set<string> = new Set();
  try {
    const entries = await fs.readdir(overridesDir);
    for (const entry of entries) {
      if (entry.endsWith('.md')) {
        overrides.add(entry.replace(/\.md$/, ''));
      }
    }
  } catch {
    // Directory doesn't exist — all defaults
  }

  const lines = ['Active agent configuration:', ''];
  for (const agent of DEFAULT_AGENTS) {
    const tag = overrides.has(agent) ? '(custom override)' : '(built-in default prompt)';
    lines.push(`  ${agent.padEnd(18)} ${tag}`);
  }
  if (overrides.size > 0) {
    lines.push('', `Override directory: .nightfall/.agents/`);
  } else {
    lines.push('', 'Override by placing .md files in .nightfall/.agents/');
  }
  return lines.join('\n');
}
