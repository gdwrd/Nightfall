import type { NightfallConfig, ProviderLifecycleEvent } from '@nightfall/shared';

export type LifecycleEventHandler = (event: ProviderLifecycleEvent) => void;

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter lifecycle: validate API key → test connectivity.
 * Emits structured events for the UI to display. Exits process on fatal error.
 */
export async function ensureOpenRouter(
  config: NightfallConfig,
  onEvent: LifecycleEventHandler,
): Promise<void> {
  onEvent({ type: 'detecting' });

  // --- Validate API key exists ---
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    onEvent({
      type: 'fatal',
      message: 'OPENROUTER_API_KEY environment variable is not set.',
    });
    process.exit(1);
  }

  onEvent({ type: 'validating_api_key' });

  // --- Test connectivity by pinging the models endpoint ---
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${OPENROUTER_API_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      onEvent({
        type: 'fatal',
        message: `OpenRouter API returned HTTP ${response.status}. Check your API key.`,
      });
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onEvent({
      type: 'fatal',
      message: `Cannot reach OpenRouter API: ${message}`,
    });
    process.exit(1);
  }

  onEvent({ type: 'api_key_valid' });
  onEvent({ type: 'ready' });

  // --- Signal model readiness ---
  const { model } = config.provider;
  onEvent({ type: 'checking_model', model });
  onEvent({ type: 'model_ready', model });
}
