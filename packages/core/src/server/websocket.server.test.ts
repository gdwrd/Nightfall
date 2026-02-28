import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'node:net';
import { WebSocket } from 'ws';
import type {
  ProviderAdapter,
  ChatMessage,
  NightfallConfig,
  ServerMessage,
} from '@nightfall/shared';
import { NightfallServer } from './websocket.server.js';

// ---------------------------------------------------------------------------
// Module-level mocks (must be at top level so Vitest can hoist them)
// ---------------------------------------------------------------------------

vi.mock('../ollama/ollama.lifecycle.js', () => ({
  ensureOllama: (_cfg: unknown, cb: (e: unknown) => void) => {
    // Immediately signal model_ready so tests don't block on Ollama
    cb({ type: 'model_ready', model: 'test-model' });
    return Promise.resolve();
  },
}));

vi.mock('../providers/openrouter/openrouter.lifecycle.js', () => ({
  ensureOpenRouter: (_cfg: unknown, cb: (e: unknown) => void) => {
    cb({ type: 'model_ready', model: 'test-model' });
    return Promise.resolve();
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('no port')));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function makeConfig(overrides: Partial<NightfallConfig> = {}): NightfallConfig {
  return {
    provider: { name: 'ollama' as const, model: 'test-model', host: 'localhost', port: 11434 },
    concurrency: { max_engineers: 2 },
    task: { max_rework_cycles: 1 },
    logs: { retention: 10 },
    ...overrides,
  };
}

function makeProvider(responses: string[] = []): ProviderAdapter {
  let idx = 0;
  return {
    async *complete(_messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
      if (signal?.aborted) return;
      const response = responses[idx++] ?? '<done>{"summary":"done"}</done>';
      yield response;
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
}

function planDone(subtasks: Array<{ id: string; description: string }>): string {
  const plan = { subtasks, complexity: 'simple', estimatedEngineers: 1 };
  return `<done>{"summary":${JSON.stringify(JSON.stringify(plan))}}</done>`;
}

/**
 * Connect a fresh WS client and collect messages until `predicate` is true
 * or `timeout` ms elapse.  Terminates the client when done.
 */
function collectUntil(
  port: number,
  predicate: (msgs: ServerMessage[]) => boolean,
  onOpen?: (ws: WebSocket) => void,
  timeout = 8000,
): Promise<{ msgs: ServerMessage[]; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs: ServerMessage[] = [];

    const done = () => resolve({ msgs, ws });

    const timer = setTimeout(done, timeout);

    ws.on('open', () => {
      onOpen?.(ws);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ServerMessage;
        msgs.push(msg);
        if (predicate(msgs)) {
          clearTimeout(timer);
          done();
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NightfallServer', () => {
  let port: number;
  let server: NightfallServer;
  const openClients: WebSocket[] = [];

  beforeEach(async () => {
    port = await getFreePort();
  });

  afterEach(async () => {
    // Close all test WS clients before shutting down the server
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN) ws.terminate();
    }
    openClients.length = 0;
    if (server) await server.close();
  });

  it('reports the correct port', () => {
    server = new NightfallServer({
      config: makeConfig(),
      provider: makeProvider(),
      projectRoot: '/tmp',
      port,
    });
    expect(server.port).toBe(port);
  });

  it('accepts WebSocket connections and can be closed cleanly', async () => {
    // NightfallServer starts listening as soon as it is constructed (WS server
    // binds in the constructor).  start() wires orchestrator events and Ollama.
    server = new NightfallServer({
      config: makeConfig(),
      provider: makeProvider(),
      projectRoot: '/tmp',
      port,
    });
    server.start();

    // Simply verify a client can connect without error.
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      openClients.push(ws);
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    // afterEach will close clients and server
  });

  it('sends ERROR when APPROVE_PLAN is called with no pending task', async () => {
    server = new NightfallServer({
      config: makeConfig(),
      provider: makeProvider(),
      projectRoot: '/tmp',
      port,
    });
    server.start();

    const { msgs, ws } = await collectUntil(
      port,
      (m) => m.some((msg) => msg.type === 'ERROR'),
      (ws) => {
        // Send APPROVE_PLAN immediately on open — no plan is pending
        ws.send(JSON.stringify({ type: 'APPROVE_PLAN', payload: {} }));
      },
    );
    openClients.push(ws);

    expect(msgs.some((m) => m.type === 'ERROR')).toBe(true);
  });

  it('broadcasts TASK_STATE(planning) after SUBMIT_TASK', async () => {
    const provider = makeProvider([planDone([{ id: 's1', description: 'Write the feature' }])]);
    server = new NightfallServer({ config: makeConfig(), provider, projectRoot: '/tmp', port });
    server.start();

    const { msgs, ws } = await collectUntil(
      port,
      (m) => m.some((msg) => msg.type === 'TASK_STATE'),
      (ws) => {
        ws.send(JSON.stringify({ type: 'SUBMIT_TASK', payload: { prompt: 'Add a button' } }));
      },
      8000,
    );
    openClients.push(ws);

    expect(msgs.some((m) => m.type === 'TASK_STATE')).toBe(true);
  });

  it('broadcasts PLAN_READY after SUBMIT_TASK completes planning', async () => {
    const provider = makeProvider([planDone([{ id: 's1', description: 'Write the feature' }])]);
    server = new NightfallServer({ config: makeConfig(), provider, projectRoot: '/tmp', port });
    server.start();

    const { msgs, ws } = await collectUntil(
      port,
      (m) => m.some((msg) => msg.type === 'PLAN_READY'),
      (ws) => {
        ws.send(JSON.stringify({ type: 'SUBMIT_TASK', payload: { prompt: 'Add a button' } }));
      },
      8000,
    );
    openClients.push(ws);

    expect(msgs.some((m) => m.type === 'PLAN_READY')).toBe(true);
  });
});
