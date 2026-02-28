import type { NightfallConfig, ProviderAdapter } from '@nightfall/shared';
import { OllamaAdapter } from './ollama/ollama.adapter.js';
import { OpenRouterAdapter } from './openrouter/openrouter.adapter.js';

export function createProvider(config: NightfallConfig): ProviderAdapter {
  switch (config.provider.name) {
    case 'ollama':
      return new OllamaAdapter(config);
    case 'openrouter':
      return new OpenRouterAdapter(config);
    default:
      throw new Error(`Unknown provider: ${(config.provider as { name: string }).name}`);
  }
}
