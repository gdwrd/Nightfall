import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { compactHandler } from '../compact.handler.js';
import { deriveProjectSlug } from '../../../memory/memory.init.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';
import type { ProviderAdapter } from '@nightfall/shared';

let tmpDir: string;
let memDir: string;

function makeProvider(response: string): ProviderAdapter {
  return {
    async *complete(): AsyncGenerator<string> {
      yield response;
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
}

function makeCtx(provider?: ProviderAdapter): CommandDispatcherContext {
  return {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: {} as CommandDispatcherContext['orchestrator'],
    provider: provider ?? makeProvider('# Compacted content'),
  };
}

async function createMemoryFile(name: string, content: string): Promise<void> {
  await fs.mkdir(memDir, { recursive: true });
  await fs.writeFile(path.join(memDir, name), content, 'utf8');
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-compact-'));
  const namespace = await deriveProjectSlug(tmpDir);
  memDir = path.join(tmpDir, '.nightfall', 'memory', namespace);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('compactHandler', () => {
  describe('empty memory directory', () => {
    it('returns warning when no memory files exist', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('No memory files found');
    });

    it('returns warning when memory directory does not exist', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('⚠');
    });
  });

  describe('with memory files', () => {
    beforeEach(async () => {
      await createMemoryFile(
        'patterns.md',
        '# Patterns\n\n- pattern 1\n- pattern 2\n- duplicate\n- duplicate\n',
      );
      await createMemoryFile('progress.md', '# Progress\n\n- old entry\n- older entry\n');
    });

    it('returns success message with file count', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('Compacted 2 files');
    });

    it('output includes file names in table', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('patterns.md');
      expect(result).toContain('progress.md');
    });

    it('output includes BEFORE and AFTER columns', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('BEFORE');
      expect(result).toContain('AFTER');
    });

    it('output includes REMOVED column', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('REMOVED');
    });

    it('output includes TOTAL row', async () => {
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('TOTAL');
    });

    it('backs up original files to .compact-backup/', async () => {
      const ctx = makeCtx();
      await compactHandler(ctx);
      const backupDir = path.join(memDir, '.compact-backup');
      const backupStat = await fs.stat(backupDir);
      expect(backupStat.isDirectory()).toBe(true);

      const backupFiles = await fs.readdir(backupDir);
      expect(backupFiles).toContain('patterns.md');
      expect(backupFiles).toContain('progress.md');
    });

    it('overwrites original files with compacted content', async () => {
      const compactedContent = '# Patterns — compacted';
      const ctx = makeCtx(makeProvider(compactedContent));
      await compactHandler(ctx);

      const patternsPath = path.join(memDir, 'patterns.md');
      const content = await fs.readFile(patternsPath, 'utf8');
      expect(content.trim()).toBe(compactedContent);
    });

    it('backup file matches original content', async () => {
      const originalContent = '# Patterns\n\n- pattern 1\n- pattern 2\n- duplicate\n- duplicate\n';
      const ctx = makeCtx();
      await compactHandler(ctx);

      const backupPath = path.join(memDir, '.compact-backup', 'patterns.md');
      const backup = await fs.readFile(backupPath, 'utf8');
      expect(backup).toBe(originalContent);
    });
  });

  describe('single file compaction message', () => {
    it('uses singular "file" for one file', async () => {
      await createMemoryFile('only.md', '# Content\nsome content\n');
      const ctx = makeCtx();
      const result = await compactHandler(ctx);
      expect(result).toContain('Compacted 1 file.');
      expect(result).not.toContain('files.');
    });
  });
});
