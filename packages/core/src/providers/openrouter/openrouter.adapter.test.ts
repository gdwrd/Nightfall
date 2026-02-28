import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { NightfallConfig, ChatMessage } from '@nightfall/shared';
import { OpenRouterAdapter } from './openrouter.adapter.js';
import { createProvider } from '../provider.factory.js';

// ---------------------------------------------------------------------------
// Mock OpenRouter server (OpenAI-compatible API)
// ---------------------------------------------------------------------------

let server: http.Server;
let serverPort: number;

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Model list — /models
      if (req.url === '/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet' },
              { id: 'openai/gpt-4o', name: 'GPT-4o' },
            ],
          }),
        );
        return;
      }

      // Chat completions — /chat/completions (SSE streaming)
      if (req.url === '/chat/completions' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          const parsed = JSON.parse(body) as { stream?: boolean };

          if (parsed.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });

            const tokens = ['Hello', ' from', ' OpenRouter', '!'];
            let i = 0;

            const interval = setInterval(() => {
              if (res.destroyed) {
                clearInterval(interval);
                return;
              }

              if (i < tokens.length) {
                const chunk = {
                  id: 'chatcmpl-test',
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: 'test-model',
                  choices: [
                    {
                      index: 0,
                      delta: { content: tokens[i] },
                      finish_reason: i === tokens.length - 1 ? 'stop' : null,
                    },
                  ],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                i++;
              } else {
                res.write('data: [DONE]\n\n');
                clearInterval(interval);
                res.end();
              }
            }, 30);

            res.on('close', () => clearInterval(interval));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'chatcmpl-test',
                object: 'chat.completion',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Hello from OpenRouter!' },
                    finish_reason: 'stop',
                  },
                ],
              }),
            );
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

function makeConfig(): NightfallConfig {
  return {
    provider: { name: 'openrouter' as const, model: 'anthropic/claude-sonnet-4' },
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

describe('OpenRouterAdapter', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.OPENROUTER_API_KEY = savedKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it('throws when OPENROUTER_API_KEY is not set', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => new OpenRouterAdapter(makeConfig())).toThrow('OPENROUTER_API_KEY');
  });

  it('streams tokens incrementally via complete()', async () => {
    const adapter = new OpenRouterAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    const chunks: string[] = [];

    for await (const token of adapter.complete(HELLO_MESSAGES)) {
      chunks.push(token);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('Hello from OpenRouter!');
  });

  it('respects an already-aborted signal', async () => {
    const adapter = new OpenRouterAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    const controller = new AbortController();
    controller.abort();

    const chunks: string[] = [];
    for await (const token of adapter.complete(HELLO_MESSAGES, controller.signal)) {
      chunks.push(token);
    }

    expect(chunks).toEqual([]);
  });

  it('stops streaming when abort signal fires mid-stream', async () => {
    const adapter = new OpenRouterAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    const controller = new AbortController();
    const chunks: string[] = [];

    for await (const token of adapter.complete(HELLO_MESSAGES, controller.signal)) {
      chunks.push(token);
      if (chunks.length === 1) {
        controller.abort();
      }
    }

    expect(chunks.length).toBeLessThanOrEqual(2);
  });

  it('isAvailable() returns true when server is running', async () => {
    const adapter = new OpenRouterAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('isAvailable() returns false for unreachable server', async () => {
    const adapter = new OpenRouterAdapter(makeConfig(), 'http://127.0.0.1:19999');
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('ensureModelReady() succeeds (no-op for cloud models)', async () => {
    const adapter = new OpenRouterAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    await expect(
      adapter.ensureModelReady('anthropic/claude-sonnet-4'),
    ).resolves.toBeUndefined();
  });
});

describe('createProvider (openrouter)', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.OPENROUTER_API_KEY = savedKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it('returns an OpenRouterAdapter for provider name "openrouter"', () => {
    const provider = createProvider(makeConfig());
    expect(provider).toBeInstanceOf(OpenRouterAdapter);
  });
});
