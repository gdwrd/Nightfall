import type { NightfallConfig, ProviderLifecycleEvent } from '@nightfall/shared';

export type LifecycleEventHandler = (event: ProviderLifecycleEvent) => void;

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter lifecycle: validate API key → test connectivity.
 * Emits structured events for the UI to display. Throws on fatal error.
 */
export async function ensureOpenRouter(
  config: NightfallConfig,
  onEvent: LifecycleEventHandler,
): Promise<void> {
  onEvent({ type: 'detecting' });

  // --- Validate API key exists ---
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const msg = 'OPENROUTER_API_KEY environment variable is not set.';
    onEvent({ type: 'fatal', message: msg });
    throw new Error(msg);
  }

  onEvent({ type: 'validating_api_key' });

  // --- Test connectivity by pinging the models endpoint ---
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(`${OPENROUTER_API_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const msg = `OpenRouter API returned HTTP ${response.status}. Check your API key.`;
      onEvent({ type: 'fatal', message: msg });
      throw new Error(msg);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenRouter API returned')) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const msg = `Cannot reach OpenRouter API: ${message}`;
    onEvent({ type: 'fatal', message: msg });
    throw new Error(msg);
  }

  onEvent({ type: 'api_key_valid' });
  onEvent({ type: 'ready' });

  // --- Signal model readiness ---
  const { model } = config.provider;
  onEvent({ type: 'checking_model', model });
  onEvent({ type: 'model_ready', model });
}
