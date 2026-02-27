export interface ProviderAdapter {
  complete(prompt: string, systemPrompt: string): AsyncGenerator<string>;
  isAvailable(): Promise<boolean>;
  ensureModelReady(model: string): Promise<void>;
}
