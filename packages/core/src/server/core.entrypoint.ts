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
import { isOllamaInstalled } from '../ollama/ollama.lifecycle.js';
import type { NightfallConfig } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { port: number; projectRoot: string } {
  const args = argv.slice(2);
  let port = 7171;
  let projectRoot = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        process.stderr.write(`Error: invalid --port value "${args[i + 1]}". Must be 1–65535.\n`);
        process.exit(1);
      }
      port = parsed;
      i++;
    } else if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = args[i + 1];
      i++;
    }
  }

  return { port, projectRoot };
}

// ---------------------------------------------------------------------------
// Pre-flight provider check
// ---------------------------------------------------------------------------

/**
 * Quick provider sanity check before the WS server starts.
 * Fails fast on clearly unrecoverable conditions so the user gets an
 * immediate, actionable error instead of a silent hang.
 */
function preflightProviderCheck(config: NightfallConfig): void {
  if (config.provider.name === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      process.stderr.write(
        'Error: OPENROUTER_API_KEY environment variable is not set.\n' +
        'Set it with: export OPENROUTER_API_KEY=<your-key>\n',
      );
      process.exit(1);
    }
  } else if (config.provider.name === 'anthropic') {
    const anthropicCfg = config.provider as { api_key?: string };
    if (!anthropicCfg.api_key && !process.env.ANTHROPIC_API_KEY) {
      process.stderr.write(
        'Error: ANTHROPIC_API_KEY environment variable is not set.\n' +
        'Set it with: export ANTHROPIC_API_KEY=<your-key>\n',
      );
      process.exit(1);
    }
  } else if (config.provider.name === 'ollama') {
    if (!isOllamaInstalled()) {
      process.stderr.write(
        'Error: Ollama is not installed.\n' +
        'Install it from: https://ollama.ai\n',
      );
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { port, projectRoot } = parseArgs(process.argv);

  const config = await loadConfig();

  // Fast pre-flight check before starting the WS server
  preflightProviderCheck(config);

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
