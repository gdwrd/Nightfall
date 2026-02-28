import { initializeMemoryBank } from '../../memory/memory.init.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

export async function initHandler(ctx: CommandDispatcherContext): Promise<string> {
  try {
    await initializeMemoryBank(ctx.projectRoot);
    return '✓ Memory bank initialized in .nightfall/memory/';
  } catch (err) {
    return `Error during /init: ${err instanceof Error ? err.message : String(err)}`;
  }
}
