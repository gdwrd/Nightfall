import OpenAI from 'openai';
import type { NightfallConfig, ProviderAdapter, ChatMessage, TokenUsage } from '@nightfall/shared';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Return true for transient errors worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    // Rate limit or server errors are retryable; auth/bad-request errors are not
    return err.status === 429 || err.status >= 500;
  }
  // Network-level errors (ECONNRESET, ENOTFOUND, ETIMEDOUT, etc.)
  if (err instanceof Error) {
    return /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(err.message);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenRouterAdapter implements ProviderAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly maxRetries: number;
  private _lastUsage: TokenUsage | null = null;

  constructor(config: NightfallConfig, baseURL?: string) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY environment variable is required for the openrouter provider',
      );
    }

    this.model = config.provider.model;
    this.baseURL = baseURL ?? OPENROUTER_BASE_URL;
    this.maxRetries = config.task.max_retries;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/nightfall-ai/nightfall',
        'X-Title': 'Nightfall',
      },
    });
  }

  async *complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) {
      return;
    }

    this._lastUsage = null;

    // Retry the initial API call with exponential backoff
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    let attempt = 0;
    while (true) {
      try {
        stream = await this.client.chat.completions.create(
          {
            model: this.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal },
        );
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

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          return;
        }
        // Capture usage from the final chunk (populated when stream_options.include_usage is set)
        if (chunk.usage) {
          this._lastUsage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    } catch (err: unknown) {
      // Swallow intentional aborts
      if (signal?.aborted) {
        return;
      }
      throw err;
    }
  }

  getLastUsage(): TokenUsage | null {
    return this._lastUsage;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureModelReady(_model: string): Promise<void> {
    // Cloud-hosted models are always ready — no pulling needed
  }
}
