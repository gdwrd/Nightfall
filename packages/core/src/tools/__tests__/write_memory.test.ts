import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeMemoryTool } from '../tools/write_memory.js';
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-write-memory-'));
  const namespace = await deriveProjectSlug(tmpDir);
  memDir = path.join(tmpDir, '.nightfall', 'memory', namespace);
  // memory.writer creates directories automatically, no need to pre-create
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('write_memory tool', () => {
  it('creates a new memory file', async () => {
    const result = await writeMemoryTool.execute(
      { file: 'patterns.md', content: '# Patterns\n- use async/await\n' },
      ctx(),
    );
    expect(result.success).toBe(true);
    const written = await fs.readFile(
      path.join(memDir, 'patterns.md'),
      'utf-8',
    );
    expect(written).toContain('use async/await');
  });

  it('overwrites an existing memory file', async () => {
    const memFile = path.join(memDir, 'overwrite.md');
    await fs.mkdir(path.dirname(memFile), { recursive: true });
    await fs.writeFile(memFile, 'old content');

    const result = await writeMemoryTool.execute(
      { file: 'overwrite.md', content: 'new content' },
      ctx(),
    );
    expect(result.success).toBe(true);
    const written = await fs.readFile(memFile, 'utf-8');
    expect(written).toContain('new content');
    expect(written).not.toContain('old content');
  });

  it('returns error when file parameter is missing', async () => {
    const result = await writeMemoryTool.execute({ content: 'x' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('returns success message with filename', async () => {
    const result = await writeMemoryTool.execute(
      { file: 'notes.md', content: '# Notes\n' },
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('notes.md');
  });
});
