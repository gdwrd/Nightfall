import type { NightfallConfig, ProviderAdapter } from '@nightfall/shared';
import { OllamaAdapter } from './ollama/ollama.adapter.js';

export function createProvider(config: NightfallConfig): ProviderAdapter {
  switch (config.provider.name) {
    case 'ollama':
      return new OllamaAdapter(config);
    default:
      throw new Error(`Unknown provider: ${config.provider.name}`);
  }
}
