import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { searchFilesTool } from '../tools/search_files.js';
import type { ToolContext } from '../tool.types.js';

let tmpDir: string;

const ctx = (): ToolContext => ({
  agentId: 'test',
  role: 'engineer',
  projectRoot: tmpDir,
});

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-search-files-'));
  await fs.writeFile(
    path.join(tmpDir, 'alpha.ts'),
    'export function hello() {}\n// TODO: remove this\n',
  );
  await fs.writeFile(path.join(tmpDir, 'beta.ts'), 'export class World {}\n');
  await fs.mkdir(path.join(tmpDir, 'node_modules'));
  await fs.writeFile(
    path.join(tmpDir, 'node_modules', 'skip.ts'),
    'TODO: should not be found\n',
  );
  await fs.mkdir(path.join(tmpDir, '.git'));
  await fs.writeFile(path.join(tmpDir, '.git', 'index'), 'TODO: git internal\n');
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('search_files tool', () => {
  it('finds matching lines with a regex pattern', async () => {
    const result = await searchFilesTool.execute({ pattern: 'hello' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('alpha.ts');
    expect(result.output).toContain('hello');
  });

  it('returns empty result when no matches found', async () => {
    const result = await searchFilesTool.execute({ pattern: 'zzznomatch999' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('no matches');
  });

  it('skips node_modules directory', async () => {
    const result = await searchFilesTool.execute({ pattern: 'TODO' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('node_modules');
  });

  it('skips .git directory', async () => {
    const result = await searchFilesTool.execute({ pattern: 'TODO' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('.git');
  });

  it('handles invalid regex by falling back to literal search', async () => {
    // '[invalid' is an invalid regex but should not crash
    const result = await searchFilesTool.execute({ pattern: '[invalid' }, ctx());
    expect(result.success).toBe(true);
  });

  it('returns error when pattern parameter is missing', async () => {
    const result = await searchFilesTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pattern/i);
  });

  it('finds multiple matches across files', async () => {
    const result = await searchFilesTool.execute({ pattern: 'export' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('alpha.ts');
    expect(result.output).toContain('beta.ts');
  });
});
