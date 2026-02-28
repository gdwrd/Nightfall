import type { CommandDispatcherContext } from '../command.dispatcher.js';

export function statusHandler(ctx: CommandDispatcherContext): string {
  const { config, projectRoot, orchestrator } = ctx;
  const providerLine =
    config.provider.name === 'ollama'
      ? `Host:    ${config.provider.host}:${config.provider.port}`
      : `Provider: OpenRouter (cloud)`;
  const lines = [
    `Project: ${projectRoot}`,
    `Model:   ${config.provider.model}`,
    providerLine,
    `Locks:   ${orchestrator.getLocks().length} held`,
    `Engineers (max): ${config.concurrency.max_engineers}`,
    `Rework cycles (max): ${config.task.max_rework_cycles}`,
  ];
  return lines.join('\n');
}
