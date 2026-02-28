import { Ollama } from 'ollama';
import type {
  NightfallConfig,
  ProviderAdapter,
  ChatMessage,
  OllamaProviderConfig,
} from '@nightfall/shared';
import { isOllamaRunning, isModelAvailable, pullModel } from '../../ollama/ollama.lifecycle.js';

export class OllamaAdapter implements ProviderAdapter {
  private readonly client: Ollama;
  private readonly providerConfig: OllamaProviderConfig;

  constructor(config: NightfallConfig) {
    if (config.provider.name !== 'ollama') {
      throw new Error('OllamaAdapter requires provider.name === "ollama"');
    }
    this.providerConfig = config.provider;
    this.client = new Ollama({
      host: `http://${this.providerConfig.host}:${this.providerConfig.port}`,
    });
  }

  async *complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) {
      return;
    }

    const stream = await this.client.chat({
      model: this.providerConfig.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    // Wire the AbortSignal to the ollama stream's abort mechanism
    const onAbort = () => stream.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          return;
        }
        if (chunk.message?.content) {
          yield chunk.message.content;
        }
      }
    } catch (err: unknown) {
      // stream.abort() throws an AbortError — swallow it when we triggered it
      if (signal?.aborted) {
        return;
      }
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async isAvailable(): Promise<boolean> {
    return isOllamaRunning(this.providerConfig.host, this.providerConfig.port);
  }

  async ensureModelReady(model: string): Promise<void> {
    const { host, port } = this.providerConfig;
    const available = await isModelAvailable(host, port, model);
    if (!available) {
      await pullModel(host, port, model, () => {});
    }
  }
}
