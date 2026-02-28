import type { CommandDispatcherContext } from '../command.dispatcher.js';
import { listOllamaModels } from '../../ollama/ollama.lifecycle.js';
import { listOpenRouterModels } from '../../providers/openrouter/openrouter.models.js';
import { writeConfig } from '../../config/config.loader.js';

interface ModelEntry {
  id: string;
  label: string;
  contextLength?: number;
}

interface ModelViewPayload {
  type: 'model_view';
  provider: string;
  currentModel: string;
  models: ModelEntry[];
}

interface ModelSavedPayload {
  type: 'model_saved';
  model: string;
}

interface ErrorPayload {
  type: 'error';
  message: string;
}

export async function modelHandler(
  ctx: CommandDispatcherContext,
  args: string,
): Promise<string> {
  const trimmed = args.trim();

  // Sub-command: select <modelId>
  if (trimmed.startsWith('select ')) {
    const modelId = trimmed.slice('select '.length).trim();
    if (!modelId) {
      return JSON.stringify({ type: 'error', message: 'No model specified.' } satisfies ErrorPayload);
    }

    const updated = {
      ...ctx.config,
      provider: { ...ctx.config.provider, model: modelId },
    };

    try {
      writeConfig(updated);
      return JSON.stringify({ type: 'model_saved', model: modelId } satisfies ModelSavedPayload);
    } catch (err) {
      return JSON.stringify({
        type: 'error',
        message: `Failed to save model: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies ErrorPayload);
    }
  }

  // Default: list available models for the current provider
  try {
    if (ctx.config.provider.name === 'ollama') {
      const { host, port } = ctx.config.provider;
      const ollamaModels = await listOllamaModels(host, port);
      const payload: ModelViewPayload = {
        type: 'model_view',
        provider: 'ollama',
        currentModel: ctx.config.provider.model,
        models: ollamaModels.map((m) => ({ id: m.name, label: m.name })),
      };
      return JSON.stringify(payload);
    } else {
      // openrouter
      const orModels = await listOpenRouterModels();
      const sorted = orModels.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
      const payload: ModelViewPayload = {
        type: 'model_view',
        provider: 'openrouter',
        currentModel: ctx.config.provider.model,
        models: sorted.map((m) => ({
          id: m.id,
          label: `${m.id}  (${m.context_length}ctx)`,
          contextLength: m.context_length,
        })),
      };
      return JSON.stringify(payload);
    }
  } catch (err) {
    return JSON.stringify({
      type: 'error',
      message: `Failed to list models: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies ErrorPayload);
  }
}
