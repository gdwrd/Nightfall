import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';

/**
 * Locate a named symbol (function, class, interface, type, const) in source text.
 * Returns the [startLine, endLine] indices (0-based) of the symbol block, or null.
 *
 * This is a regex-based heuristic that handles common TypeScript/JavaScript patterns.
 * It works by finding the declaration line and then matching braces/indentation to
 * determine the end of the block.
 */
function findSymbolRange(lines: string[], symbol: string): [number, number] | null {
  // Patterns that declare a named symbol at the top level
  const declarationPatterns = [
    // class Foo / export class Foo / export default class Foo
    new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:abstract\\s+)?class\\s+${symbol}[\\s<{(]`),
    // function foo / export function foo / export async function foo
    new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}[\\s(<]`),
    // export const foo = / const foo = (for arrow functions or objects)
    new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+${symbol}\\s*[=:]`),
    // interface Foo / export interface Foo
    new RegExp(`^(?:export\\s+)?interface\\s+${symbol}[\\s<{]`),
    // type Foo = / export type Foo =
    new RegExp(`^(?:export\\s+)?type\\s+${symbol}\\s*[=<]`),
    // enum Foo / export enum Foo / export const enum Foo
    new RegExp(`^(?:export\\s+)?(?:const\\s+)?enum\\s+${symbol}[\\s{]`),
  ];

  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (declarationPatterns.some((p) => p.test(trimmed))) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) return null;

  // Walk forward to find the end of the block by tracking brace depth.
  // We start counting from the declaration line.
  let depth = 0;
  let foundOpenBrace = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        foundOpenBrace = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    // For type aliases and simple declarations that end with `;`, stop at semicolon
    if (!foundOpenBrace && line.includes(';')) {
      return [startLine, i];
    }
    if (foundOpenBrace && depth === 0) {
      return [startLine, i];
    }
  }

  // If we never found a closing brace, return just the declaration line
  return [startLine, startLine];
}

export const readFileTool: ToolImpl = {
  definition: {
    name: 'read_file',
    description:
      'Read a source file. Optionally restrict to a line range (startLine/endLine, 1-based) or a named symbol (function, class, interface, type).',
    parameters: {
      path: {
        type: 'string',
        description: 'Absolute or project-relative path to the file.',
        required: true,
      },
      startLine: {
        type: 'number',
        description: 'First line to return (1-based, inclusive). Used with endLine.',
        required: false,
      },
      endLine: {
        type: 'number',
        description: 'Last line to return (1-based, inclusive). Used with startLine.',
        required: false,
      },
      symbol: {
        type: 'string',
        description: 'Name of a function, class, interface, or type to extract.',
        required: false,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = String(params['path'] ?? '').trim();
    if (!filePath) {
      return {
        tool: 'read_file',
        success: false,
        output: '',
        error: 'Missing required parameter: path',
      };
    }

    const resolved = path.isAbsolute(filePath) ? filePath : path.join(ctx.projectRoot, filePath);

    let content: string;
    try {
      content = await fs.readFile(resolved, 'utf-8');
    } catch (err) {
      return {
        tool: 'read_file',
        success: false,
        output: '',
        error: `Cannot read file "${resolved}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const lines = content.split('\n');
    const symbol = params['symbol'] ? String(params['symbol']).trim() : undefined;

    if (symbol) {
      const range = findSymbolRange(lines, symbol);
      if (!range) {
        return {
          tool: 'read_file',
          success: false,
          output: '',
          error: `Symbol "${symbol}" not found in ${filePath}`,
        };
      }
      const [start, end] = range;
      const extracted = lines.slice(start, end + 1).join('\n');
      return {
        tool: 'read_file',
        success: true,
        output: `// ${filePath} — lines ${start + 1}–${end + 1} (symbol: ${symbol})\n${extracted}`,
      };
    }

    const startLine = params['startLine'] != null ? Number(params['startLine']) : undefined;
    const endLine = params['endLine'] != null ? Number(params['endLine']) : undefined;

    if (startLine != null || endLine != null) {
      const from = Math.max(0, (startLine ?? 1) - 1);
      const to = endLine != null ? endLine : lines.length;
      const slice = lines.slice(from, to).join('\n');
      return {
        tool: 'read_file',
        success: true,
        output: `// ${filePath} — lines ${from + 1}–${Math.min(to, lines.length)}\n${slice}`,
      };
    }

    // Full file read
    return { tool: 'read_file', success: true, output: content };
  },
};
