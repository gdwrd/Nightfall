export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

/**
 * Fetch the full list of available models from OpenRouter.
 * The /api/v1/models endpoint is publicly accessible (no API key required).
 */
export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data: OpenRouterModel[] };
  return data.data;
}
