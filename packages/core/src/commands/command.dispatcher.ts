import type { NightfallConfig } from '@nightfall/shared';
import type { TaskOrchestrator } from '../orchestrator/task.orchestrator.js';
import { helpHandler } from './handlers/help.handler.js';
import { initHandler } from './handlers/init.handler.js';
import { statusHandler } from './handlers/status.handler.js';
import { configHandler } from './handlers/config.handler.js';
import { historyHandler } from './handlers/history.handler.js';
import { agentsHandler } from './handlers/agents.handler.js';
import { memoryHandler } from './handlers/memory.handler.js';
import { compactHandler } from './handlers/compact.handler.js';
import { clearHandler } from './handlers/clear.handler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandDispatcherContext {
  config: NightfallConfig;
  projectRoot: string;
  orchestrator: TaskOrchestrator;
}

// ---------------------------------------------------------------------------
// CommandDispatcher
// ---------------------------------------------------------------------------

/**
 * Routes SLASH_COMMAND messages from the WebSocket server to the appropriate
 * handler and returns the text output to send back as SLASH_RESULT.
 */
export class CommandDispatcher {
  constructor(private readonly ctx: CommandDispatcherContext) {}

  async dispatch(command: string, _args: string): Promise<string> {
    switch (command.toLowerCase()) {
      case '/help':
        return helpHandler();

      case '/init':
        return initHandler(this.ctx);

      case '/status':
        return statusHandler(this.ctx);

      case '/config':
        return configHandler(this.ctx);

      case '/history':
        return historyHandler(this.ctx);

      case '/agents':
        return agentsHandler(this.ctx);

      case '/memory':
        return memoryHandler();

      case '/compact':
        return compactHandler();

      case '/clear':
        return clearHandler();

      default:
        return `Unknown command: ${command}. Type /help for available commands.`;
    }
  }
}
