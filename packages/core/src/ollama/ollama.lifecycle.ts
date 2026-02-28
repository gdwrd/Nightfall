import { spawn } from 'node:child_process';
import type { NightfallConfig } from '@nightfall/shared';

export type OllamaLifecycleEvent =
  | { type: 'detecting' }
  | { type: 'starting' }
  | { type: 'ready' }
  | { type: 'checking_model'; model: string }
  | { type: 'pulling_model'; model: string; progress: number }
  | { type: 'model_ready'; model: string }
  | { type: 'fatal'; message: string };

export type LifecycleEventHandler = (event: OllamaLifecycleEvent) => void;

/**
 * Check whether the Ollama HTTP server is reachable.
 */
export async function isOllamaRunning(host: string, port: number): Promise<boolean> {
  const url = `http://${host}:${port}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Spawn `ollama serve` and wait until it starts responding (max 10s).
 */
export async function startOllama(host: string, port: number): Promise<void> {
  spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (await isOllamaRunning(host, port)) {
      return;
    }
  }
  throw new Error('Ollama did not start within 10 seconds');
}

/**
 * Check if a specific model is available locally.
 */
export async function isModelAvailable(
  host: string,
  port: number,
  model: string,
): Promise<boolean> {
  const url = `http://${host}:${port}/api/tags`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return false;
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    // Ollama model names can have tags; check exact match or prefix match
    return models.some((m) => m.name === model || m.name.startsWith(`${model}:`));
  } catch {
    return false;
  }
}

/**
 * Stream `ollama pull <model>` and emit progress events (0–100).
 */
export async function pullModel(
  host: string,
  port: number,
  model: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  const url = `http://${host}:${port}/api/pull`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Failed to pull model "${model}": HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('No response body from Ollama pull API');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as {
          status?: string;
          completed?: number;
          total?: number;
        };
        if (json.completed !== undefined && json.total !== undefined && json.total > 0) {
          const pct = Math.round((json.completed / json.total) * 100);
          onProgress(pct);
        } else if (json.status === 'success') {
          onProgress(100);
        }
      } catch {
        // Non-JSON line — ignore
      }
    }
  }
}

/**
 * Full Ollama lifecycle: detect → (start) → validate model → (pull model).
 * Emits structured events for the UI to display. Exits process on fatal error.
 */
export async function ensureOllama(
  config: NightfallConfig,
  onEvent: LifecycleEventHandler,
): Promise<void> {
  const { host, port, model } = config.provider;

  onEvent({ type: 'detecting' });

  const running = await isOllamaRunning(host, port);

  if (!running) {
    onEvent({ type: 'starting' });
    try {
      await startOllama(host, port);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'fatal', message: `Failed to start Ollama: ${message}` });
      process.exit(1);
    }

    // Verify Ollama is reachable after startup attempt
    const nowRunning = await isOllamaRunning(host, port);
    if (!nowRunning) {
      onEvent({ type: 'fatal', message: 'Ollama is not reachable after startup attempt.' });
      process.exit(1);
    }
  }

  onEvent({ type: 'ready' });

  onEvent({ type: 'checking_model', model });

  const modelAvailable = await isModelAvailable(host, port, model);

  if (!modelAvailable) {
    onEvent({ type: 'pulling_model', model, progress: 0 });
    try {
      await pullModel(host, port, model, (progress) => {
        onEvent({ type: 'pulling_model', model, progress });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'fatal', message: `Failed to pull model "${model}": ${message}` });
      process.exit(1);
    }
  }

  onEvent({ type: 'model_ready', model });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
