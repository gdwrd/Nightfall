export interface OllamaProviderConfig {
  name: 'ollama';
  model: string;
  host: string;
  port: number;
}

export interface OpenRouterProviderConfig {
  name: 'openrouter';
  model: string;
  /** Optional API key override; defaults to OPENROUTER_API_KEY env var. */
  api_key?: string;
}

export interface AnthropicProviderConfig {
  name: 'anthropic';
  model: string;
  /** Optional API key override; defaults to ANTHROPIC_API_KEY env var. */
  api_key?: string;
}

export type ProviderConfig =
  | OllamaProviderConfig
  | OpenRouterProviderConfig
  | AnthropicProviderConfig;

export interface AgentIterationOverrides {
  /** Maximum number of LLM round-trips before the agent gives up. */
  max_iterations?: number;
}

export interface NightfallConfig {
  provider: ProviderConfig;
  /**
   * Optional override for the model's context window size (in tokens).
   * When set, agents use this value instead of the built-in per-model defaults.
   */
  context_window?: number;
  /**
   * Optional memory namespace directory. Derived from project slug at runtime;
   * can be overridden in config.yaml to use a fixed namespace.
   */
  memoryNamespace?: string;
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
  /**
   * Per-role agent iteration overrides. When set, these override the hardcoded
   * defaults in agent.factory.ts (team-lead: 20, engineer: 30, reviewer: 20,
   * memory-manager: 20).
   */
  agents?: {
    'team-lead'?: AgentIterationOverrides;
    engineer?: AgentIterationOverrides;
    reviewer?: AgentIterationOverrides;
    'memory-manager'?: AgentIterationOverrides;
  };
}
