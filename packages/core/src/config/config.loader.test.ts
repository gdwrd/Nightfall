import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { OllamaProviderConfig } from '@nightfall/shared';

// Use a hardcoded temp path to avoid needing os.tmpdir() inside the mock
const MOCK_HOME = `/tmp/nightfall-test-${process.pid}`;
const NIGHTFALL_DIR = path.join(MOCK_HOME, '.nightfall');
const CONFIG_PATH = path.join(NIGHTFALL_DIR, 'config.yaml');

vi.mock('node:os', () => ({
  default: { homedir: () => MOCK_HOME },
  homedir: () => MOCK_HOME,
}));

describe('config.loader', () => {
  beforeEach(() => {
    vi.resetModules();
    if (fs.existsSync(NIGHTFALL_DIR)) {
      fs.rmSync(NIGHTFALL_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(NIGHTFALL_DIR)) {
      fs.rmSync(NIGHTFALL_DIR, { recursive: true });
    }
  });

  it('returns defaults when config file is missing', async () => {
    const { loadConfig } = await import('./config.loader.js');
    const { DEFAULT_CONFIG } = await import('./config.defaults.js');
    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('creates ~/.nightfall directory when it does not exist', async () => {
    const { loadConfig } = await import('./config.loader.js');
    expect(fs.existsSync(NIGHTFALL_DIR)).toBe(false);
    await loadConfig();
    expect(fs.existsSync(NIGHTFALL_DIR)).toBe(true);
  });

  it('loads user overrides and merges with defaults', async () => {
    const { loadConfig } = await import('./config.loader.js');
    const { DEFAULT_CONFIG } = await import('./config.defaults.js');
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      `
provider:
  model: llama3:8b
  port: 11435
concurrency:
  max_engineers: 5
`,
    );

    const config = await loadConfig();
    expect(config.provider.name).toBe(DEFAULT_CONFIG.provider.name);
    expect(config.provider.model).toBe('llama3:8b');

    // Narrow to OllamaProviderConfig for Ollama-specific fields
    expect(config.provider.name).toBe('ollama');
    const provider = config.provider as OllamaProviderConfig;
    const defaultProvider = DEFAULT_CONFIG.provider as OllamaProviderConfig;
    expect(provider.port).toBe(11435);
    expect(provider.host).toBe(defaultProvider.host);

    expect(config.concurrency.max_engineers).toBe(5);
    expect(config.task.max_rework_cycles).toBe(DEFAULT_CONFIG.task.max_rework_cycles);
    expect(config.logs.retention).toBe(DEFAULT_CONFIG.logs.retention);
  });

  it('handles an empty config file by using defaults', async () => {
    const { loadConfig } = await import('./config.loader.js');
    const { DEFAULT_CONFIG } = await import('./config.defaults.js');
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, '');

    const config = await loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('throws on invalid port in config file', async () => {
    const { loadConfig } = await import('./config.loader.js');
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `provider:\n  port: 99999\n`);
    await expect(loadConfig()).rejects.toThrow('provider.port');
  });

  it('accepts a valid openrouter provider config', async () => {
    const { loadConfig } = await import('./config.loader.js');
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      `
provider:
  name: openrouter
  model: anthropic/claude-sonnet-4
`,
    );

    const config = await loadConfig();
    expect(config.provider.name).toBe('openrouter');
    expect(config.provider.model).toBe('anthropic/claude-sonnet-4');
  });

  it('throws on unknown provider name', async () => {
    const { loadConfig } = await import('./config.loader.js');
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `provider:\n  name: unknown_provider\n`);
    await expect(loadConfig()).rejects.toThrow('unknown provider');
  });
});
