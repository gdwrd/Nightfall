import { describe, it, expect } from 'vitest';
import { configHandler } from '../config.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';
import type { NightfallConfig } from '@nightfall/shared';

function makeCtx(config: Partial<NightfallConfig> = {}): CommandDispatcherContext {
  const fullConfig: NightfallConfig = {
    provider: { name: 'ollama', model: 'deepseek-r1:14b', host: 'localhost', port: 11434 },
    concurrency: { max_engineers: 2 },
    task: { max_rework_cycles: 1, max_retries: 3, max_context_tokens: 8192 },
    logs: { retention: 7 },
    ...config,
  };
  return {
    config: fullConfig,
    projectRoot: '/project',
    orchestrator: {} as CommandDispatcherContext['orchestrator'],
    provider: {} as CommandDispatcherContext['provider'],
  };
}

describe('configHandler', () => {
  it('returns valid JSON string', () => {
    const ctx = makeCtx();
    const result = configHandler(ctx);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('output includes provider config', () => {
    const ctx = makeCtx();
    const result = configHandler(ctx);
    const parsed = JSON.parse(result) as NightfallConfig;
    expect(parsed.provider.name).toBe('ollama');
    expect(parsed.provider.model).toBe('deepseek-r1:14b');
  });

  it('output includes concurrency settings', () => {
    const ctx = makeCtx();
    const result = configHandler(ctx);
    const parsed = JSON.parse(result) as NightfallConfig;
    expect(parsed.concurrency.max_engineers).toBe(2);
  });

  it('output includes task settings', () => {
    const ctx = makeCtx();
    const result = configHandler(ctx);
    const parsed = JSON.parse(result) as NightfallConfig;
    expect(parsed.task.max_rework_cycles).toBe(1);
  });

  it('returns pretty-printed JSON with indentation', () => {
    const ctx = makeCtx();
    const result = configHandler(ctx);
    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  it('reflects openrouter config correctly', () => {
    const ctx = makeCtx({ provider: { name: 'openrouter', model: 'gpt-4' } });
    const result = configHandler(ctx);
    const parsed = JSON.parse(result) as NightfallConfig;
    expect(parsed.provider.name).toBe('openrouter');
    expect(parsed.provider.model).toBe('gpt-4');
  });

  it('returns string (synchronous)', () => {
    const ctx = makeCtx();
    const result = configHandler(ctx);
    expect(typeof result).toBe('string');
  });
});
