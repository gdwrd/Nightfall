import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';
import { resolveAndValidatePath } from './path.utils.js';

const MAX_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.nightfall']);

async function collectFiles(
  dir: string,
  extension: string,
  projectRoot: string,
  results: string[],
): Promise<void> {
  if (results.length >= MAX_FILES) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_FILES) break;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectFiles(fullPath, extension, projectRoot, results);
    } else if (entry.isFile()) {
      if (extension && !entry.name.endsWith(extension)) continue;
      results.push(path.relative(projectRoot, fullPath));
    }
  }
}

export const listFilesTool: ToolImpl = {
  definition: {
    name: 'list_files',
    description:
      'List files in a directory recursively. Returns project-relative paths. ' +
      'Skips node_modules, .git, dist, and .nightfall directories.',
    parameters: {
      dir: {
        type: 'string',
        description:
          'Directory to list, relative to the project root. Defaults to the project root.',
        required: false,
      },
      extension: {
        type: 'string',
        description: 'Only include files with this extension, e.g. ".ts" or ".json".',
        required: false,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const dirParam = params['dir'] ? String(params['dir']).trim() : '.';
    const extension = params['extension'] ? String(params['extension']).trim() : '';

    let absDir: string;
    try {
      absDir = resolveAndValidatePath(dirParam, ctx.projectRoot);
    } catch (err) {
      return {
        tool: 'list_files',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Verify the directory exists
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) {
        return {
          tool: 'list_files',
          success: false,
          output: '',
          error: `"${dirParam}" is not a directory`,
        };
      }
    } catch {
      return {
        tool: 'list_files',
        success: false,
        output: '',
        error: `Directory "${dirParam}" does not exist`,
      };
    }

    const results: string[] = [];
    await collectFiles(absDir, extension, ctx.projectRoot, results);

    const total = results.length;
    const lines = results.join('\n');
    const suffix = total >= MAX_FILES ? `\n[capped at ${MAX_FILES} files]` : '';

    return {
      tool: 'list_files',
      success: true,
      output: total > 0 ? `${lines}${suffix}` : '(no files found)',
    };
  },
};
