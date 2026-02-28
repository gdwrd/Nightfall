import { Ollama } from 'ollama';
import type { AbortableAsyncIterator, ChatResponse as OllamaChatResponse } from 'ollama';
import type {
  NightfallConfig,
  ProviderAdapter,
  ChatMessage,
  OllamaProviderConfig,
  TokenUsage,
} from '@nightfall/shared';
import { isOllamaRunning, isModelAvailable, pullModel } from '../../ollama/ollama.lifecycle.js';

/** Return true for transient network errors worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    return /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(err.message);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OllamaAdapter implements ProviderAdapter {
  private readonly client: Ollama;
  private readonly providerConfig: OllamaProviderConfig;
  private readonly maxRetries: number;
  private _lastUsage: TokenUsage | null = null;

  constructor(config: NightfallConfig) {
    if (config.provider.name !== 'ollama') {
      throw new Error('OllamaAdapter requires provider.name === "ollama"');
    }
    this.providerConfig = config.provider;
    this.maxRetries = config.task.max_retries;
    this.client = new Ollama({
      host: `http://${this.providerConfig.host}:${this.providerConfig.port}`,
    });
  }

  async *complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) {
      return;
    }

    this._lastUsage = null;

    // Retry the initial chat call with exponential backoff on transient errors
    let stream: AbortableAsyncIterator<OllamaChatResponse>;
    let attempt = 0;
    while (true) {
      try {
        stream = await this.client.chat({
          model: this.providerConfig.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        });
        break;
      } catch (err: unknown) {
        if (signal?.aborted || !isRetryable(err) || attempt >= this.maxRetries) {
          throw err;
        }
        attempt++;
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 16_000);
        await sleep(delayMs);
      }
    }

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
        // Capture token usage from the final done chunk
        if (chunk.done && chunk.prompt_eval_count != null && chunk.eval_count != null) {
          const promptTokens = chunk.prompt_eval_count;
          const completionTokens = chunk.eval_count;
          this._lastUsage = {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          };
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

  getLastUsage(): TokenUsage | null {
    return this._lastUsage;
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
