import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFileTool } from '../tools/write_file.js';
import type { ToolContext } from '../tool.types.js';

let tmpDir: string;

const ctx = (): ToolContext => ({
  agentId: 'test',
  role: 'engineer',
  projectRoot: tmpDir,
});

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-write-file-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('write_file tool', () => {
  it('creates a file with content', async () => {
    const result = await writeFileTool.execute(
      { path: 'output.ts', content: 'hello world' },
      ctx(),
    );
    expect(result.success).toBe(true);
    const written = await fs.readFile(path.join(tmpDir, 'output.ts'), 'utf-8');
    expect(written).toBe('hello world');
  });

  it('overwrites an existing file', async () => {
    await fs.writeFile(path.join(tmpDir, 'existing.ts'), 'old content');
    const result = await writeFileTool.execute(
      { path: 'existing.ts', content: 'new content' },
      ctx(),
    );
    expect(result.success).toBe(true);
    const written = await fs.readFile(path.join(tmpDir, 'existing.ts'), 'utf-8');
    expect(written).toBe('new content');
  });

  it('creates intermediate directories', async () => {
    const result = await writeFileTool.execute(
      { path: 'deep/nested/dir/file.ts', content: 'nested content' },
      ctx(),
    );
    expect(result.success).toBe(true);
    const written = await fs.readFile(
      path.join(tmpDir, 'deep', 'nested', 'dir', 'file.ts'),
      'utf-8',
    );
    expect(written).toBe('nested content');
  });

  it('returns error when path parameter is missing', async () => {
    const result = await writeFileTool.execute({ content: 'x' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  it('returns error when path escapes project root', async () => {
    const result = await writeFileTool.execute({ path: '../outside.ts', content: 'x' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside/i);
  });

  it('includes byte count in success output', async () => {
    const content = 'some content here';
    const result = await writeFileTool.execute({ path: 'counted.ts', content }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain(String(content.length));
  });
});
