import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import type { NightfallConfig } from '@nightfall/shared';
import { DEFAULT_CONFIG } from './config.defaults.js';

const NIGHTFALL_DIR = path.join(os.homedir(), '.nightfall');
const CONFIG_PATH = path.join(NIGHTFALL_DIR, 'config.yaml');

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal !== null &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

function validateConfig(config: NightfallConfig): void {
  const { provider, concurrency, task, logs } = config;

  if (!provider.name || typeof provider.name !== 'string') {
    throw new Error('Config validation failed: provider.name must be a non-empty string');
  }
  if (!provider.model || typeof provider.model !== 'string') {
    throw new Error('Config validation failed: provider.model must be a non-empty string');
  }

  // Provider-specific validation
  switch (provider.name) {
    case 'ollama': {
      if (!provider.host || typeof provider.host !== 'string') {
        throw new Error('Config validation failed: provider.host must be a non-empty string');
      }
      if (typeof provider.port !== 'number' || provider.port <= 0 || provider.port > 65535) {
        throw new Error(
          'Config validation failed: provider.port must be a valid port number (1-65535)',
        );
      }
      break;
    }
    case 'openrouter':
      // No host/port needed. API key is validated at runtime via env var.
      break;
    default:
      throw new Error(
        `Config validation failed: unknown provider "${String((provider as unknown as { name: string }).name)}"`,
      );
  }

  if (typeof concurrency.max_engineers !== 'number' || concurrency.max_engineers < 1) {
    throw new Error('Config validation failed: concurrency.max_engineers must be >= 1');
  }
  if (typeof task.max_rework_cycles !== 'number' || task.max_rework_cycles < 0) {
    throw new Error('Config validation failed: task.max_rework_cycles must be >= 0');
  }
  if (typeof task.max_retries !== 'number' || task.max_retries < 0) {
    throw new Error('Config validation failed: task.max_retries must be >= 0');
  }
  if (typeof task.max_context_tokens !== 'number' || task.max_context_tokens < 1000) {
    throw new Error('Config validation failed: task.max_context_tokens must be >= 1000');
  }
  if (typeof logs.retention !== 'number' || logs.retention < 1) {
    throw new Error('Config validation failed: logs.retention must be >= 1');
  }
}

export function writeConfig(config: NightfallConfig): void {
  validateConfig(config);
  if (!fs.existsSync(NIGHTFALL_DIR)) {
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, yaml.dump(config as unknown as Record<string, unknown>), 'utf8');
}

export async function loadConfig(): Promise<NightfallConfig> {
  // Ensure ~/.nightfall/ exists
  if (!fs.existsSync(NIGHTFALL_DIR)) {
    fs.mkdirSync(NIGHTFALL_DIR, { recursive: true });
  }

  let userConfig: Partial<NightfallConfig> = {};

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = yaml.load(raw);
    if (parsed !== null && typeof parsed === 'object') {
      userConfig = parsed as Partial<NightfallConfig>;
    }
  } else {
    const defaultYaml = yaml.dump(DEFAULT_CONFIG as unknown as Record<string, unknown>);
    fs.writeFileSync(CONFIG_PATH, defaultYaml, 'utf8');
    process.stderr.write(`Created default config at ${CONFIG_PATH}\n`);
  }

  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    userConfig as Record<string, unknown>,
  ) as unknown as NightfallConfig;

  validateConfig(merged);
  return merged;
}

export { NIGHTFALL_DIR, CONFIG_PATH };
