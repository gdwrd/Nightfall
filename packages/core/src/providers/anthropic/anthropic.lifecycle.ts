import type { NightfallConfig, ProviderLifecycleEvent } from '@nightfall/shared';

export type LifecycleEventHandler = (event: ProviderLifecycleEvent) => void;

/**
 * Anthropic lifecycle: validate API key at startup.
 * Emits structured events for the UI to display. Throws on fatal error.
 */
export async function checkAnthropicKey(
  config: NightfallConfig,
  onEvent: LifecycleEventHandler,
): Promise<void> {
  onEvent({ type: 'detecting' });

  // Resolve API key: config-level override takes priority over env var
  const anthropicConfig = config.provider.name === 'anthropic' ? config.provider : undefined;
  const apiKey = anthropicConfig?.api_key ?? process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    const msg = 'ANTHROPIC_API_KEY environment variable is not set.';
    onEvent({ type: 'fatal', message: msg });
    throw new Error(msg);
  }

  onEvent({ type: 'validating_api_key' });

  // Validate the key by hitting a lightweight endpoint (list models)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const msg = `Anthropic API returned HTTP ${response.status}. Check your API key.`;
      onEvent({ type: 'fatal', message: msg });
      throw new Error(msg);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Anthropic API returned')) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const msg = `Cannot reach Anthropic API: ${message}`;
    onEvent({ type: 'fatal', message: msg });
    throw new Error(msg);
  }

  onEvent({ type: 'api_key_valid' });
  onEvent({ type: 'ready' });

  const model = anthropicConfig?.model ?? 'claude-sonnet-4-6';
  onEvent({ type: 'checking_model', model });
  onEvent({ type: 'model_ready', model });
}
