import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { agentsHandler } from '../agents.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';

let tmpDir: string;
let ctx: CommandDispatcherContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-agents-'));
  ctx = {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: {} as CommandDispatcherContext['orchestrator'],
    provider: {} as CommandDispatcherContext['provider'],
  };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('agentsHandler', () => {
  describe('no overrides directory', () => {
    it('lists all 4 default agents', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('team-lead');
      expect(result).toContain('engineer');
      expect(result).toContain('reviewer');
      expect(result).toContain('memory-manager');
    });

    it('marks all agents as built-in default prompt', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('built-in default prompt');
      expect(result).not.toContain('custom override');
    });

    it('includes header line', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('Active agent configuration');
    });

    it('suggests override directory path', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('.nightfall/.agents/');
    });
  });

  describe('with override files', () => {
    beforeEach(async () => {
      const overridesDir = path.join(tmpDir, '.nightfall', '.agents');
      await fs.mkdir(overridesDir, { recursive: true });
      await fs.writeFile(path.join(overridesDir, 'engineer.md'), '# Custom engineer prompt');
    });

    it('marks overridden agent as custom', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('custom override');
    });

    it('marks non-overridden agents as built-in', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('built-in default prompt');
    });

    it('shows override directory path in output', async () => {
      const result = await agentsHandler(ctx);
      expect(result).toContain('Override directory');
    });
  });

  describe('with all agents overridden', () => {
    beforeEach(async () => {
      const overridesDir = path.join(tmpDir, '.nightfall', '.agents');
      await fs.mkdir(overridesDir, { recursive: true });
      for (const agent of ['team-lead', 'engineer', 'reviewer', 'memory-manager']) {
        await fs.writeFile(path.join(overridesDir, `${agent}.md`), `# ${agent} override`);
      }
    });

    it('marks all agents as custom override', async () => {
      const result = await agentsHandler(ctx);
      expect(result).not.toContain('built-in default prompt');
      const matches = result.match(/custom override/g) ?? [];
      expect(matches.length).toBe(4);
    });
  });

  describe('ignores non-.md files in overrides dir', () => {
    beforeEach(async () => {
      const overridesDir = path.join(tmpDir, '.nightfall', '.agents');
      await fs.mkdir(overridesDir, { recursive: true });
      await fs.writeFile(path.join(overridesDir, 'engineer.txt'), 'not an override');
    });

    it('treats .txt file as no override', async () => {
      const result = await agentsHandler(ctx);
      expect(result).not.toContain('custom override');
    });
  });
});
