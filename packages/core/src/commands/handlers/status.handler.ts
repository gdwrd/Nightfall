import type { CommandDispatcherContext } from '../command.dispatcher.js';

export function statusHandler(ctx: CommandDispatcherContext): string {
  const { config, projectRoot, orchestrator } = ctx;
  const lines = [
    `Project: ${projectRoot}`,
    `Model:   ${config.provider.model}`,
    `Host:    ${config.provider.host}:${config.provider.port}`,
    `Locks:   ${orchestrator.getLocks().length} held`,
    `Engineers (max): ${config.concurrency.max_engineers}`,
    `Rework cycles (max): ${config.task.max_rework_cycles}`,
  ];
  return lines.join('\n');
}
