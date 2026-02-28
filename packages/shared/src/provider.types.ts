export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderAdapter {
  complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;
  ensureModelReady(model: string): Promise<void>;
}
