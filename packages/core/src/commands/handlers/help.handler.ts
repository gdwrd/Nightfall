const SLASH_COMMANDS: Record<string, string> = {
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

export function helpHandler(): string {
  const lines = ['Available commands:', ''];
  for (const [cmd, desc] of Object.entries(SLASH_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(12)} ${desc}`);
  }
  return lines.join('\n');
}
