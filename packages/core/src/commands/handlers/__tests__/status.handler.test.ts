import { describe, it, expect } from 'vitest';
import { statusHandler } from '../status.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';
import type { NightfallConfig } from '@nightfall/shared';

function makeCtx(overrides: Partial<NightfallConfig> = {}): CommandDispatcherContext {
  const baseConfig: NightfallConfig = {
    provider: { name: 'ollama', model: 'deepseek-r1:14b', host: 'localhost', port: 11434 },
    concurrency: { max_engineers: 3 },
    task: { max_rework_cycles: 2, max_retries: 3, max_context_tokens: 8192 },
    logs: { retention: 10 },
    ...overrides,
  };
  return {
    config: baseConfig,
    projectRoot: '/home/user/myproject',
    orchestrator: {
      getLocks: () => [],
    } as unknown as CommandDispatcherContext['orchestrator'],
    provider: {} as CommandDispatcherContext['provider'],
  };
}

describe('statusHandler', () => {
  it('includes project root in output', () => {
    const ctx = makeCtx();
    const result = statusHandler(ctx);
    expect(result).toContain('/home/user/myproject');
  });

  it('includes model name in output', () => {
    const ctx = makeCtx();
    const result = statusHandler(ctx);
    expect(result).toContain('deepseek-r1:14b');
  });

  it('includes max_engineers in output', () => {
    const ctx = makeCtx();
    const result = statusHandler(ctx);
    expect(result).toContain('3');
  });

  it('includes max_rework_cycles in output', () => {
    const ctx = makeCtx();
    const result = statusHandler(ctx);
    expect(result).toContain('2');
  });

  describe('ollama provider', () => {
    it('shows host and port for ollama provider', () => {
      const ctx = makeCtx();
      const result = statusHandler(ctx);
      expect(result).toContain('localhost');
      expect(result).toContain('11434');
    });

    it('does not show OpenRouter text for ollama', () => {
      const ctx = makeCtx();
      const result = statusHandler(ctx);
      expect(result).not.toContain('OpenRouter');
    });
  });

  describe('openrouter provider', () => {
    it('shows OpenRouter cloud label for openrouter provider', () => {
      const ctx = makeCtx();
      ctx.config.provider = { name: 'openrouter', model: 'claude-3-opus' };
      const result = statusHandler(ctx);
      expect(result).toContain('OpenRouter');
    });

    it('does not show host/port for openrouter', () => {
      const ctx = makeCtx();
      ctx.config.provider = { name: 'openrouter', model: 'claude-3-opus' };
      const result = statusHandler(ctx);
      expect(result).not.toContain('11434');
    });
  });

  it('includes lock count from orchestrator', () => {
    const ctx = makeCtx();
    ctx.orchestrator = {
      getLocks: () => ['lock-a', 'lock-b'],
    } as unknown as CommandDispatcherContext['orchestrator'];
    const result = statusHandler(ctx);
    expect(result).toContain('2');
  });

  it('returns string (synchronous)', () => {
    const ctx = makeCtx();
    const result = statusHandler(ctx);
    expect(typeof result).toBe('string');
  });
});
