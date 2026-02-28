import type { NightfallConfig } from '@nightfall/shared';
import { initializeMemoryBank, TaskLogger } from '@nightfall/core';
import type { IOrchestrator } from './ws.client.js';

// ---------------------------------------------------------------------------
// Slash command registry
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: Record<string, string> = {
  '/init': 'Initialize the memory bank for this project',
  '/memory': 'Trigger Memory Manager to review and update memory bank',
  '/status': 'Show current model, project root, and memory bank state',
  '/history': 'List recent task runs',
  '/config': 'Show current configuration',
  '/agents': 'Show active agent configurations',
  '/clear': 'Clear message log',
  '/help': 'Show all available commands',
  '/compact': 'Compress conversation history (future feature)',
};

// ---------------------------------------------------------------------------
// Context passed to command handlers
// ---------------------------------------------------------------------------

export interface SlashCommandContext {
  config: NightfallConfig;
  orchestrator: IOrchestrator;
  projectRoot: string;
  addMessage: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle a slash command input.
 * Returns a string message to display, 'exit' to quit, or null for no output.
 */
export async function handleSlashCommand(
  input: string,
  ctx: SlashCommandContext,
): Promise<string | 'exit' | null> {
  const [command = '', ...rest] = input.trim().split(/\s+/);
  const args = rest.join(' ');

  switch (command.toLowerCase()) {
    case '/help':
      return formatHelp();

    case '/init':
      return await runInit(ctx);

    case '/status':
      return formatStatus(ctx);

    case '/config':
      return formatConfig(ctx.config);

    case '/history':
      return await formatHistory(ctx);

    case '/agents':
      return formatAgents(ctx);

    case '/clear':
      // Special sentinel — App.tsx recognises '[clear]' and resets the message log.
      return '[clear]';

    case '/compact':
      return '! /compact — conversation compression not yet implemented.';

    case '/memory':
      return '! /memory — trigger memory update by submitting a task: "update memory bank"';

    case '/exit':
    case '/quit':
      return 'exit';

    default:
      void args; // args reserved for future sub-commands
      return `Unknown command: ${command}. Type /help for available commands.`;
  }
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

function formatHelp(): string {
  const lines = ['Available commands:', ''];
  for (const [cmd, desc] of Object.entries(SLASH_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(12)} ${desc}`);
  }
  return lines.join('\n');
}

async function runInit(ctx: SlashCommandContext): Promise<string> {
  try {
    ctx.addMessage('Initializing memory bank…');
    await initializeMemoryBank(ctx.projectRoot);
    return '✓ Memory bank initialized in .nightfall/memory/';
  } catch (err) {
    return `Error during /init: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatStatus(ctx: SlashCommandContext): string {
  const { config, projectRoot } = ctx;
  const lines = [
    `Project: ${projectRoot}`,
    `Model:   ${config.provider.model}`,
    `Host:    ${config.provider.host}:${config.provider.port}`,
    `Locks:   ${ctx.orchestrator.getLocks().length} held`,
    `Engineers (max): ${config.concurrency.max_engineers}`,
    `Rework cycles (max): ${config.task.max_rework_cycles}`,
  ];
  return lines.join('\n');
}

function formatConfig(config: NightfallConfig): string {
  return JSON.stringify(config, null, 2);
}

async function formatHistory(ctx: SlashCommandContext): Promise<string> {
  try {
    const logger = new TaskLogger(ctx.projectRoot);
    const runs = await logger.listLogs();
    if (runs.length === 0) return 'No task history found.';

    const lines = ['Recent tasks:', ''];
    for (const run of runs.slice(0, 10)) {
      const date = new Date(run.startedAt).toLocaleString();
      const duration = run.completedAt
        ? `${Math.round((run.completedAt - run.startedAt) / 1000)}s`
        : 'ongoing';
      const status = run.status === 'completed' ? '✓' : run.status === 'cancelled' ? '✗' : '!';
      lines.push(`  ${status} [${date}] ${truncate(run.prompt, 50)} (${duration})`);
    }
    return lines.join('\n');
  } catch {
    return 'Could not read task history.';
  }
}

function formatAgents(_ctx: SlashCommandContext): string {
  return [
    'Active agent configuration:',
    '  team-lead      — built-in default prompt',
    '  engineer       — built-in default prompt',
    '  reviewer       — built-in default prompt',
    '  memory-manager — built-in default prompt',
    '',
    'Override by placing .md files in .nightfall/.agents/',
  ].join('\n');
}

function truncate(str: string, max: number): string {
  const s = str.replace(/\n/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
