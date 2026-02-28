export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderAdapter {
  complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;
  ensureModelReady(model: string): Promise<void>;
  /** Returns token usage from the most recent complete() call, or null if unavailable. */
  getLastUsage?(): TokenUsage | null;
}
