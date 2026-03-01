import Anthropic from '@anthropic-ai/sdk';
import type {
  NightfallConfig,
  ProviderAdapter,
  ChatMessage,
  TokenUsage,
  AnthropicProviderConfig,
} from '@nightfall/shared';

export class AnthropicAdapter implements ProviderAdapter {
  private readonly client: Anthropic;
  private readonly providerConfig: AnthropicProviderConfig;
  private _lastUsage: TokenUsage | null = null;

  constructor(config: NightfallConfig, baseURL?: string) {
    if (config.provider.name !== 'anthropic') {
      throw new Error('AnthropicAdapter requires provider.name === "anthropic"');
    }
    this.providerConfig = config.provider;

    const apiKey = this.providerConfig.api_key ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for the anthropic provider',
      );
    }

    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      maxRetries: config.task.max_retries,
    });
  }

  async *complete(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) {
      return;
    }

    this._lastUsage = null;

    // Anthropic uses a top-level `system` parameter instead of a system message
    const systemContent = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');

    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = this.client.messages.stream(
      {
        model: this.providerConfig.model,
        max_tokens: 8192,
        ...(systemContent ? { system: systemContent } : {}),
        messages: chatMessages,
      },
      { signal },
    );

    try {
      // Iterate raw SSE events; extract text from content_block_delta events
      for await (const event of stream) {
        if (signal?.aborted) {
          return;
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }

      // Capture token usage from the completed message
      const finalMessage = await stream.finalMessage();
      this._lastUsage = {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      };
    } catch (err: unknown) {
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
    // The API key was validated at construction; cloud service is always reachable
    // when a valid key is present (no health endpoint to ping).
    return true;
  }

  async ensureModelReady(_model: string): Promise<void> {
    // Cloud-hosted models are always ready — no pulling needed
  }
}
