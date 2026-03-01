import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readMemoryTool } from '../tools/read_memory.js';
import { deriveProjectSlug } from '../../memory/memory.init.js';
import type { ToolContext } from '../tool.types.js';

let tmpDir: string;
let memDir: string;

const ctx = (): ToolContext => ({
  agentId: 'test',
  role: 'memory-manager',
  projectRoot: tmpDir,
});

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-read-memory-'));
  const namespace = await deriveProjectSlug(tmpDir);
  memDir = path.join(tmpDir, '.nightfall', 'memory', namespace);
  await fs.mkdir(memDir, { recursive: true });
  await fs.writeFile(path.join(memDir, 'patterns.md'), '# Patterns\n- use async/await\n');
  await fs.writeFile(path.join(memDir, 'index.md'), '# Memory Index\n');
  await fs.writeFile(path.join(memDir, 'empty.md'), '');
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('read_memory tool', () => {
  it('reads an existing memory file', async () => {
    const result = await readMemoryTool.execute({ file: 'patterns.md' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('use async/await');
  });

  it('resolves "index" shorthand to index.md', async () => {
    const result = await readMemoryTool.execute({ file: 'index' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('Memory Index');
  });

  it('returns error for non-existent file', async () => {
    const result = await readMemoryTool.execute({ file: 'does-not-exist.md' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns success with empty content for an empty file', async () => {
    const result = await readMemoryTool.execute({ file: 'empty.md' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });

  it('returns error when file parameter is missing', async () => {
    const result = await readMemoryTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });
});
