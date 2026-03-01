import type { NightfallConfig } from '@nightfall/shared';

/**
 * Per-model context window sizes (in tokens).
 * Used when `NightfallConfig.context_window` is not explicitly set.
 * Checked by substring match against the configured model name.
 */
export const MODEL_CONTEXT_DEFAULTS: Record<string, number> = {
  'deepseek-r1:14b': 16_384,
  'deepseek-r1:7b': 16_384,
  'deepseek-r1:32b': 32_768,
  openrouter: 32_768,
};

export const DEFAULT_CONFIG: NightfallConfig = {
  provider: {
    name: 'ollama',
    model: 'deepseek-r1:14b',
    host: 'localhost',
    port: 11434,
  },
  concurrency: {
    max_engineers: 3,
  },
  task: {
    max_rework_cycles: 3,
    max_retries: 3,
    max_context_tokens: 80_000,
  },
  logs: {
    retention: 50,
  },
};
