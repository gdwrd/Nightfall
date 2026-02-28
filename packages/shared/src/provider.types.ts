export interface ProviderAdapter {
  complete(prompt: string, systemPrompt: string, signal?: AbortSignal): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;
  ensureModelReady(model: string): Promise<void>;
}
