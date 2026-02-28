import { Ollama } from 'ollama';
import type { NightfallConfig, ProviderAdapter, ChatMessage } from '@nightfall/shared';
import { isOllamaRunning, isModelAvailable, pullModel } from '../../ollama/ollama.lifecycle.js';

export class OllamaAdapter implements ProviderAdapter {
  private readonly client: Ollama;
  private readonly config: NightfallConfig;

  constructor(config: NightfallConfig) {
    this.config = config;
    this.client = new Ollama({
      host: `http://${config.provider.host}:${config.provider.port}`,
    });
  }

  async *complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) {
      return;
    }

    const stream = await this.client.chat({
      model: this.config.provider.model,
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
    return isOllamaRunning(this.config.provider.host, this.config.provider.port);
  }

  async ensureModelReady(model: string): Promise<void> {
    const { host, port } = this.config.provider;
    const available = await isModelAvailable(host, port, model);
    if (!available) {
      await pullModel(host, port, model, () => {});
    }
  }
}
