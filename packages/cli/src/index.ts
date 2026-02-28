#!/usr/bin/env node
/**
 * nightfall — local-first multi-agent CLI coding tool
 *
 * Starts the Ollama lifecycle, creates the task orchestrator, and renders
 * the ink terminal UI.
 */
import React from 'react';
import { render } from 'ink';
import { loadConfig, createProvider, TaskOrchestrator } from '@nightfall/core';
import { App } from './components/App.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  const projectRoot = process.cwd();
  const provider = createProvider(config);

  const orchestrator = new TaskOrchestrator({ config, provider, projectRoot });

  const { waitUntilExit } = render(
    React.createElement(App, { config, orchestrator, projectRoot }),
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
}

main().catch((err: unknown) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + '\n',
  );
  process.exit(1);
});
