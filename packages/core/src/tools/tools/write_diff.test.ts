import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeDiffTool } from './write_diff.js';
import type { ToolContext } from '../tool.types.js';

let tmpDir: string;

const ctx = (): ToolContext => ({
  agentId: 'engineer-1',
  role: 'engineer',
  projectRoot: tmpDir,
});

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-write-diff-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

beforeEach(async () => {
  await fs.writeFile(path.join(tmpDir, 'target.ts'), 'const a = 1;\nconst b = 2;\n');
});

describe('write_diff tool', () => {
  it('should apply a valid unified diff to a file', async () => {
    // Build a diff that changes `const b = 2;` to `const b = 99;`
    const diff = [
      '--- target.ts',
      '+++ target.ts',
      '@@ -1,2 +1,2 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 99;',
      '',
    ].join('\n');

    const result = await writeDiffTool.execute({ path: 'target.ts', diff }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('applied');

    const written = await fs.readFile(path.join(tmpDir, 'target.ts'), 'utf-8');
    expect(written).toContain('const b = 99;');
    expect(written).not.toContain('const b = 2;');
  });

  it('should return error when diff does not apply cleanly', async () => {
    const staleDiff = [
      '--- target.ts',
      '+++ target.ts',
      '@@ -1,2 +1,2 @@',
      ' const x = 999;',
      '-const y = 888;',
      '+const y = 777;',
      '',
    ].join('\n');

    const result = await writeDiffTool.execute({ path: 'target.ts', diff: staleDiff }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return error when path is missing', async () => {
    const result = await writeDiffTool.execute({ diff: '--- a\n+++ b\n' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('should return error when diff is missing', async () => {
    const result = await writeDiffTool.execute({ path: 'target.ts' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });
});
