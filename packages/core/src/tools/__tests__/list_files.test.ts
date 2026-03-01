import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { listFilesTool } from '../tools/list_files.js';
import type { ToolContext } from '../tool.types.js';

let tmpDir: string;

const ctx = (): ToolContext => ({
  agentId: 'test',
  role: 'engineer',
  projectRoot: tmpDir,
});

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-list-files-'));
  await fs.writeFile(path.join(tmpDir, 'foo.ts'), 'foo');
  await fs.writeFile(path.join(tmpDir, 'bar.ts'), 'bar');
  await fs.writeFile(path.join(tmpDir, 'readme.md'), '# readme');
  await fs.mkdir(path.join(tmpDir, 'subdir'));
  await fs.writeFile(path.join(tmpDir, 'subdir', 'baz.ts'), 'baz');
  await fs.mkdir(path.join(tmpDir, 'node_modules'));
  await fs.writeFile(path.join(tmpDir, 'node_modules', 'skip.ts'), 'skip');
  await fs.mkdir(path.join(tmpDir, '.git'));
  await fs.writeFile(path.join(tmpDir, '.git', 'config'), 'gitconfig');
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('list_files tool', () => {
  it('lists files in a temp dir', async () => {
    const result = await listFilesTool.execute({}, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('foo.ts');
    expect(result.output).toContain('bar.ts');
    expect(result.output).toContain('readme.md');
  });

  it('lists files in nested directories', async () => {
    const result = await listFilesTool.execute({}, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/subdir[/\\]baz\.ts/);
  });

  it('respects node_modules exclusion', async () => {
    const result = await listFilesTool.execute({}, ctx());
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('node_modules');
    expect(result.output).not.toContain('skip.ts');
  });

  it('respects .git exclusion', async () => {
    const result = await listFilesTool.execute({}, ctx());
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('.git');
    expect(result.output).not.toContain('gitconfig');
  });

  it('returns error for non-existent path', async () => {
    const result = await listFilesTool.execute({ dir: 'nonexistent' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not exist/i);
  });

  it('filters by extension', async () => {
    const result = await listFilesTool.execute({ extension: '.ts' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('foo.ts');
    expect(result.output).not.toContain('readme.md');
  });
});
