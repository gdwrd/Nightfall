import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { NightfallConfig, ChatMessage } from '@nightfall/shared';
import { AnthropicAdapter } from './anthropic.adapter.js';
import { createProvider } from '../provider.factory.js';

// ---------------------------------------------------------------------------
// Mock Anthropic API server
// ---------------------------------------------------------------------------

let server: http.Server;
let serverPort: number;

/** Track request count so individual tests can simulate failures on early requests. */
let requestCount = 0;
/** When set, the next N requests return this status code instead of 200. */
let failNextRequests = 0;
let failStatusCode = 529;

function writeEvent(res: http.ServerResponse, eventType: string, data: object) {
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      // Anthropic Messages API endpoint (SDK posts to /v1/messages)
      if (req.url === '/v1/messages' && req.method === 'POST') {
        requestCount++;

        // Simulate transient failures for retry tests
        if (failNextRequests > 0) {
          failNextRequests--;
          res.writeHead(failStatusCode, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              type: 'error',
              error: { type: 'overloaded_error', message: 'Overloaded' },
            }),
          );
          return;
        }

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

            const tokens = ['Hello', ' from', ' Anthropic', '!'];

            // Send message_start
            writeEvent(res, 'message_start', {
              type: 'message_start',
              message: {
                id: 'msg_test',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-sonnet-4-6',
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            });

            // Send content_block_start
            writeEvent(res, 'content_block_start', {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            });

            // Send ping
            writeEvent(res, 'ping', { type: 'ping' });

            // Stream token deltas
            let i = 0;
            const interval = setInterval(() => {
              if (res.destroyed) {
                clearInterval(interval);
                return;
              }

              if (i < tokens.length) {
                writeEvent(res, 'content_block_delta', {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: tokens[i] },
                });
                i++;
              } else {
                writeEvent(res, 'content_block_stop', {
                  type: 'content_block_stop',
                  index: 0,
                });
                writeEvent(res, 'message_delta', {
                  type: 'message_delta',
                  delta: { stop_reason: 'end_turn', stop_sequence: null },
                  usage: { output_tokens: tokens.length },
                });
                writeEvent(res, 'message_stop', { type: 'message_stop' });
                clearInterval(interval);
                res.end();
              }
            }, 30);

            res.on('close', () => clearInterval(interval));
          } else {
            // Non-streaming response
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'msg_test',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: 'Hello from Anthropic!' }],
                model: 'claude-sonnet-4-6',
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 4 },
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
    provider: { name: 'anthropic' as const, model: 'claude-sonnet-4-6' },
    concurrency: { max_engineers: 3 },
    task: { max_rework_cycles: 3 },
    logs: { retention: 50 },
  } as unknown as NightfallConfig;
}

// ---------------------------------------------------------------------------
// Test setup
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

// ---------------------------------------------------------------------------
// AnthropicAdapter tests
// ---------------------------------------------------------------------------

describe('AnthropicAdapter', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    requestCount = 0;
    failNextRequests = 0;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('throws when ANTHROPIC_API_KEY is not set and no api_key in config', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicAdapter(makeConfig())).toThrow('ANTHROPIC_API_KEY');
  });

  it('uses api_key from config when env var is not set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const config = {
      ...makeConfig(),
      provider: { name: 'anthropic' as const, model: 'claude-sonnet-4-6', api_key: 'config-key' },
    } as unknown as NightfallConfig;
    expect(() => new AnthropicAdapter(config)).not.toThrow();
  });

  it('streams tokens incrementally via complete()', async () => {
    const adapter = new AnthropicAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    const chunks: string[] = [];

    for await (const token of adapter.complete(HELLO_MESSAGES)) {
      chunks.push(token);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('Hello from Anthropic!');
  });

  it('tracks token usage after a completed stream', async () => {
    const adapter = new AnthropicAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );

    expect(adapter.getLastUsage()).toBeNull();

    const chunks: string[] = [];
    for await (const token of adapter.complete(HELLO_MESSAGES)) {
      chunks.push(token);
    }
    expect(chunks.length).toBeGreaterThan(0);

    const usage = adapter.getLastUsage();
    expect(usage).not.toBeNull();
    expect(usage!.promptTokens).toBe(10);
    expect(usage!.completionTokens).toBe(4);
    expect(usage!.totalTokens).toBe(14);
  });

  it('respects an already-aborted signal', async () => {
    const adapter = new AnthropicAdapter(
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
    const adapter = new AnthropicAdapter(
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

  it('retries on 529 (overloaded) error and eventually succeeds', async () => {
    // First request fails with 529; second succeeds
    failNextRequests = 1;
    failStatusCode = 529;

    // maxRetries must be >= 1 for the retry to happen
    const config = makeConfig();
    (config as unknown as { task: { max_retries: number; max_rework_cycles: number } }).task.max_retries = 2;

    const adapter = new AnthropicAdapter(
      config,
      `http://127.0.0.1:${serverPort}`,
    );

    const chunks: string[] = [];
    for await (const token of adapter.complete(HELLO_MESSAGES)) {
      chunks.push(token);
    }

    expect(requestCount).toBe(2);
    expect(chunks.join('')).toBe('Hello from Anthropic!');
  }, 15_000);

  it('isAvailable() returns true when adapter is constructed with a valid key', async () => {
    const adapter = new AnthropicAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('ensureModelReady() is a no-op for cloud models', async () => {
    const adapter = new AnthropicAdapter(
      makeConfig(),
      `http://127.0.0.1:${serverPort}`,
    );
    await expect(adapter.ensureModelReady('claude-sonnet-4-6')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createProvider factory tests
// ---------------------------------------------------------------------------

describe('createProvider (anthropic)', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('returns an AnthropicAdapter for provider name "anthropic"', () => {
    const provider = createProvider(makeConfig());
    expect(provider).toBeInstanceOf(AnthropicAdapter);
  });
});
