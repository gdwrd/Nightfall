import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileTool } from './read_file.js';
import type { ToolContext } from '../tool.types.js';

let tmpDir: string;

const ctx = (): ToolContext => ({
  agentId: 'test',
  role: 'engineer',
  projectRoot: tmpDir,
});

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-read-file-'));

  await fs.writeFile(
    path.join(tmpDir, 'sample.ts'),
    [
      'export interface MyInterface {',
      '  name: string;',
      '}',
      '',
      'export class MyClass {',
      '  private value: number;',
      '  constructor(v: number) {',
      '    this.value = v;',
      '  }',
      '  getValue(): number {',
      '    return this.value;',
      '  }',
      '}',
      '',
      'export function myFunction(x: number): number {',
      '  return x * 2;',
      '}',
    ].join('\n'),
  );
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('read_file tool', () => {
  it('should read a full file', async () => {
    const result = await readFileTool.execute({ path: 'sample.ts' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('MyClass');
    expect(result.output).toContain('MyInterface');
    expect(result.output).toContain('myFunction');
  });

  it('should extract a class by symbol name', async () => {
    const result = await readFileTool.execute({ path: 'sample.ts', symbol: 'MyClass' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('class MyClass');
    expect(result.output).toContain('getValue');
    // Should NOT include the function after the class
    expect(result.output).not.toContain('myFunction');
  });

  it('should extract an interface by symbol name', async () => {
    const result = await readFileTool.execute({ path: 'sample.ts', symbol: 'MyInterface' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('MyInterface');
    expect(result.output).not.toContain('MyClass');
  });

  it('should extract a function by symbol name', async () => {
    const result = await readFileTool.execute({ path: 'sample.ts', symbol: 'myFunction' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('myFunction');
    expect(result.output).toContain('return x * 2');
  });

  it('should return error for unknown symbol', async () => {
    const result = await readFileTool.execute({ path: 'sample.ts', symbol: 'NonExistent' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('should read a line range', async () => {
    const result = await readFileTool.execute(
      { path: 'sample.ts', startLine: 1, endLine: 3 },
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('MyInterface');
    expect(result.output).not.toContain('MyClass');
  });

  it('should return error for non-existent file', async () => {
    const result = await readFileTool.execute({ path: 'does-not-exist.ts' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot read/i);
  });

  it('should return error when path is missing', async () => {
    const result = await readFileTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });
});
