import OpenAI from 'openai';
import type { NightfallConfig, ProviderAdapter, ChatMessage } from '@nightfall/shared';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterAdapter implements ProviderAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly baseURL: string;

  constructor(config: NightfallConfig, baseURL?: string) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY environment variable is required for the openrouter provider',
      );
    }

    this.model = config.provider.model;
    this.baseURL = baseURL ?? OPENROUTER_BASE_URL;
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

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      },
      { signal },
    );

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          return;
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
