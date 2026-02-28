import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';
import { resolveAndValidatePath } from './path.utils.js';

const MAX_RESULTS = 50;
const MAX_FILE_SIZE = 500_000; // 500 KB — skip binary/huge files
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.nightfall']);

async function searchDir(
  dir: string,
  regex: RegExp,
  extension: string,
  projectRoot: string,
  results: string[],
): Promise<void> {
  if (results.length >= MAX_RESULTS) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) break;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await searchDir(fullPath, regex, extension, projectRoot, results);
    } else if (entry.isFile()) {
      if (extension && !entry.name.endsWith(extension)) continue;

      let content: string;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const relPath = path.relative(projectRoot, fullPath);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_RESULTS) break;
        regex.lastIndex = 0;
        if (regex.test(lines[i]!)) {
          results.push(`${relPath}:${i + 1}: ${lines[i]!.trim()}`);
        }
      }
    }
  }
}

export const searchFilesTool: ToolImpl = {
  definition: {
    name: 'search_files',
    description:
      'Search for a text pattern across files in the project. ' +
      'Returns matching lines with file path and line number. ' +
      'Skips node_modules, .git, dist, and .nightfall directories.',
    parameters: {
      pattern: {
        type: 'string',
        description: 'Text or regular expression pattern to search for.',
        required: true,
      },
      dir: {
        type: 'string',
        description:
          'Directory to search in, relative to the project root. Defaults to the project root.',
        required: false,
      },
      extension: {
        type: 'string',
        description: 'Only search files with this extension, e.g. ".ts" or ".json".',
        required: false,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = String(params['pattern'] ?? '').trim();
    if (!pattern) {
      return {
        tool: 'search_files',
        success: false,
        output: '',
        error: 'Missing required parameter: pattern',
      };
    }

    const dirParam = params['dir'] ? String(params['dir']).trim() : '.';
    const extension = params['extension'] ? String(params['extension']).trim() : '';

    let absDir: string;
    try {
      absDir = resolveAndValidatePath(dirParam, ctx.projectRoot);
    } catch (err) {
      return {
        tool: 'search_files',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Build regex — fall back to literal string search if pattern is invalid regex
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'g');
    } catch {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, 'g');
    }

    const results: string[] = [];
    await searchDir(absDir, regex, extension, ctx.projectRoot, results);

    if (results.length === 0) {
      return { tool: 'search_files', success: true, output: '(no matches found)' };
    }

    const suffix = results.length >= MAX_RESULTS ? `\n[capped at ${MAX_RESULTS} matches]` : '';
    return {
      tool: 'search_files',
      success: true,
      output: `${results.join('\n')}${suffix}`,
    };
  },
};
