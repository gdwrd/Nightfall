#!/usr/bin/env node
/**
 * nightfall-core — standalone core process entry point
 *
 * Boots the full Nightfall backend (config, Ollama lifecycle, WebSocket server)
 * and listens for connections from any compatible UI.
 *
 * Usage:
 *   nightfall-core [--port <number>] [--project-root <path>]
 *
 * The CLI spawns this process and connects to it via NightfallWsClient.
 * It can also be run independently for debugging or to serve a web UI.
 */
import { loadConfig } from '../config/config.loader.js';
import { createProvider } from '../providers/provider.factory.js';
import { NightfallServer } from './websocket.server.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { port: number; projectRoot: string } {
  const args = argv.slice(2);
  let port = 7432;
  let projectRoot = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = args[i + 1];
      i++;
    }
  }

  return { port, projectRoot };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { port, projectRoot } = parseArgs(process.argv);

  const config = await loadConfig();
  const provider = createProvider(config);

  const server = new NightfallServer({ config, provider, projectRoot, port });
  server.start();

  // Signal the parent process (or any reader of stdout) that the server is ready
  process.stdout.write(JSON.stringify({ type: 'ready', port }) + '\n');

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
