export interface OllamaProviderConfig {
  name: 'ollama';
  model: string;
  host: string;
  port: number;
}

export interface OpenRouterProviderConfig {
  name: 'openrouter';
  model: string;
}

export type ProviderConfig = OllamaProviderConfig | OpenRouterProviderConfig;

export interface NightfallConfig {
  provider: ProviderConfig;
  concurrency: {
    max_engineers: number;
  };
  task: {
    max_rework_cycles: number;
    max_retries: number;
    max_context_tokens: number;
  };
  logs: {
    retention: number;
  };
}
