import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { updateIndexTool } from '../tools/update_index.js';
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-update-index-'));
  const namespace = await deriveProjectSlug(tmpDir);
  memDir = path.join(tmpDir, '.nightfall', 'memory', namespace);
});

beforeEach(async () => {
  // Reset memory directory for each test to avoid cross-test state
  await fs.rm(memDir, { recursive: true, force: true });
  await fs.mkdir(memDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('update_index tool', () => {
  it('adds a top-level entry to the index', async () => {
    const result = await updateIndexTool.execute(
      { file: 'auth.md', description: 'Authentication patterns' },
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('auth.md');
    expect(result.output).toContain('Authentication patterns');
  });

  it('adds a component entry to the index', async () => {
    const result = await updateIndexTool.execute(
      { file: 'components/button.md', description: 'Button component patterns', isComponent: true },
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('components/button.md');
  });

  it('updates an existing entry without creating duplicates', async () => {
    await updateIndexTool.execute(
      { file: 'api.md', description: 'Old description' },
      ctx(),
    );
    const result = await updateIndexTool.execute(
      { file: 'api.md', description: 'Updated description' },
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('Updated description');
  });

  it('returns error when required parameters are missing', async () => {
    const result = await updateIndexTool.execute({ file: 'test.md' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('returns error when both file and description are missing', async () => {
    const result = await updateIndexTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('persists the index entry to disk', async () => {
    await updateIndexTool.execute(
      { file: 'persisted.md', description: 'A persisted entry' },
      ctx(),
    );
    const indexPath = path.join(memDir, 'index.md');
    const content = await fs.readFile(indexPath, 'utf-8');
    expect(content).toContain('persisted.md');
  });
});
