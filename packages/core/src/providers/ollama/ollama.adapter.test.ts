import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { NightfallConfig, ChatMessage, OllamaProviderConfig } from '@nightfall/shared';
import { OllamaAdapter } from './ollama.adapter.js';
import { createProvider } from '../provider.factory.js';

// ---------------------------------------------------------------------------
// Mock Ollama server
// ---------------------------------------------------------------------------

let server: http.Server;
let serverPort: number;

function buildChatChunk(content: string, done: boolean) {
  return JSON.stringify({
    model: 'test-model',
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done,
    ...(done
      ? {
          done_reason: 'stop',
          total_duration: 100,
          load_duration: 10,
          prompt_eval_count: 5,
          prompt_eval_duration: 20,
          eval_count: 3,
          eval_duration: 30,
        }
      : {}),
  });
}

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Health check — Ollama root endpoint
      if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200);
        res.end('Ollama is running');
        return;
      }

      // Model list — /api/tags
      if (req.url === '/api/tags' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [{ name: 'test-model:latest' }],
          }),
        );
        return;
      }

      // Chat endpoint — /api/chat
      if (req.url === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const parsed = JSON.parse(body) as { stream?: boolean };

          if (parsed.stream) {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

            const tokens = ['Hello', ' from', ' Ollama', '!'];
            let i = 0;

            const interval = setInterval(() => {
              if (res.destroyed) {
                clearInterval(interval);
                return;
              }

              if (i < tokens.length) {
                const isLast = i === tokens.length - 1;
                res.write(buildChatChunk(tokens[i], isLast) + '\n');
                i++;
              } else {
                clearInterval(interval);
                res.end();
              }
            }, 30);

            // Clean up if client disconnects
            res.on('close', () => clearInterval(interval));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(buildChatChunk('Hello from Ollama!', true));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<OllamaProviderConfig> = {}): NightfallConfig {
  return {
    provider: {
      name: 'ollama' as const,
      model: 'test-model',
      host: '127.0.0.1',
      port: serverPort,
      ...overrides,
    },
    concurrency: { max_engineers: 3 },
    task: { max_rework_cycles: 3 },
    logs: { retention: 50 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await startMockServer();
});

afterAll(() => {
  server.close();
});

const HELLO_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Say hello' },
];

describe('OllamaAdapter', () => {
  it('streams tokens incrementally via complete()', async () => {
    const adapter = new OllamaAdapter(makeConfig());
    const chunks: string[] = [];

    for await (const token of adapter.complete(HELLO_MESSAGES)) {
      chunks.push(token);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('Hello from Ollama!');
  });

  it('respects an already-aborted signal', async () => {
    const adapter = new OllamaAdapter(makeConfig());
    const controller = new AbortController();
    controller.abort();

    const chunks: string[] = [];
    for await (const token of adapter.complete(HELLO_MESSAGES, controller.signal)) {
      chunks.push(token);
    }

    expect(chunks).toEqual([]);
  });

  it('stops streaming when abort signal fires mid-stream', async () => {
    const adapter = new OllamaAdapter(makeConfig());
    const controller = new AbortController();
    const chunks: string[] = [];

    for await (const token of adapter.complete(HELLO_MESSAGES, controller.signal)) {
      chunks.push(token);
      // Abort after collecting the first token
      if (chunks.length === 1) {
        controller.abort();
      }
    }

    // Should have collected at most 1-2 tokens before abort took effect
    expect(chunks.length).toBeLessThanOrEqual(2);
  });

  it('isAvailable() returns true when server is running', async () => {
    const adapter = new OllamaAdapter(makeConfig());
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('isAvailable() returns false for unreachable server', async () => {
    const adapter = new OllamaAdapter(makeConfig({ port: 19999 }));
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('ensureModelReady() succeeds when model is already available', async () => {
    const adapter = new OllamaAdapter(makeConfig());
    // test-model:latest is listed by the mock /api/tags endpoint
    await expect(adapter.ensureModelReady('test-model')).resolves.toBeUndefined();
  });
});

describe('createProvider', () => {
  it('returns an OllamaAdapter for provider name "ollama"', () => {
    const provider = createProvider(makeConfig());
    expect(provider).toBeInstanceOf(OllamaAdapter);
  });

  it('throws on unknown provider name', () => {
    const config = {
      provider: { name: 'openai', model: 'test-model' },
      concurrency: { max_engineers: 3 },
      task: { max_rework_cycles: 3 },
      logs: { retention: 50 },
    } as unknown as NightfallConfig;
    expect(() => createProvider(config)).toThrow('Unknown provider: openai');
  });
});
