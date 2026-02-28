#!/usr/bin/env node
/**
 * nightfall — local-first multi-agent CLI coding tool
 *
 * Architecture (Phase 12):
 *   1. Start a NightfallServer (core WebSocket server) on a local port
 *   2. Connect NightfallWsClient to that server
 *   3. Render the ink UI — it communicates entirely via the WS client
 *
 * This keeps the core engine UI-agnostic: a future web UI or VS Code extension
 * can connect to the same server without any engine changes.
 */
import React from 'react';
import { render } from 'ink';
import { loadConfig, createProvider, NightfallServer } from '@nightfall/core';
import { NightfallWsClient } from './ws.client.js';
import { App } from './components/App.js';

/** Find a free port by binding to :0 and reading back the assigned port. */
async function getFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not determine free port')));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const projectRoot = process.cwd();
  const provider = createProvider(config);

  // ── Pick a free port and start the core WS server ─────────────────────────
  const port = await getFreePort();
  const server = new NightfallServer({ config, provider, projectRoot, port });
  server.start();

  // ── Connect the WS client ──────────────────────────────────────────────────
  const client = new NightfallWsClient(`ws://127.0.0.1:${port}`);

  // Retry connect briefly — the server needs a tick to start listening
  let connected = false;
  for (let attempt = 0; attempt < 10 && !connected; attempt++) {
    try {
      await client.connect();
      connected = true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (!connected) {
    process.stderr.write('Failed to connect to core server\n');
    await server.close();
    process.exit(1);
  }

  // ── Render the ink UI ──────────────────────────────────────────────────────
  const { waitUntilExit } = render(
    React.createElement(App, { config, orchestrator: client, projectRoot }),
    { exitOnCtrlC: false },
  );

  await waitUntilExit();

  // ── Cleanup ────────────────────────────────────────────────────────────────
  client.close();
  await server.close();
}

main().catch((err: unknown) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + '\n',
  );
  process.exit(1);
});
