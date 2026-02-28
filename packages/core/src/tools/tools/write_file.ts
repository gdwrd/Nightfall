import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';
import { resolveAndValidatePath } from './path.utils.js';

export const writeFileTool: ToolImpl = {
  definition: {
    name: 'write_file',
    description:
      'Create or overwrite a file with the given content. ' +
      'Use this for new files; use write_diff for modifying existing files.',
    parameters: {
      path: {
        type: 'string',
        description: 'Absolute or project-relative path to the file to create or overwrite.',
        required: true,
      },
      content: {
        type: 'string',
        description: 'Full content to write to the file.',
        required: true,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = String(params['path'] ?? '').trim();
    const content = String(params['content'] ?? '');

    if (!filePath) {
      return {
        tool: 'write_file',
        success: false,
        output: '',
        error: 'Missing required parameter: path',
      };
    }

    let resolved: string;
    try {
      resolved = resolveAndValidatePath(filePath, ctx.projectRoot);
    } catch (err) {
      return {
        tool: 'write_file',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');
      return {
        tool: 'write_file',
        success: true,
        output: `Wrote ${content.length} bytes to ${filePath}`,
      };
    } catch (err) {
      return {
        tool: 'write_file',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
