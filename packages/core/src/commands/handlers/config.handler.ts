import type { CommandDispatcherContext } from '../command.dispatcher.js';

export function configHandler(ctx: CommandDispatcherContext): string {
  return JSON.stringify(ctx.config, null, 2);
}
