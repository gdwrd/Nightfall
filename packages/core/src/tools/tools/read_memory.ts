import { MemoryManager } from '../../memory/memory.manager.js';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';

export const readMemoryTool: ToolImpl = {
  definition: {
    name: 'read_memory',
    description:
      'Read a file from the memory bank. Pass "index" to load the index, or a relative path like "components/auth.md".',
    parameters: {
      file: {
        type: 'string',
        description:
          'Relative path within .nightfall/memory/ (e.g. "index.md", "components/db.md"). Use "index" as shorthand for "index.md".',
        required: true,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const file = String(params['file'] ?? '').trim();
    if (!file) {
      return {
        tool: 'read_memory',
        success: false,
        output: '',
        error: 'Missing required parameter: file',
      };
    }

    const resolved = file === 'index' ? 'index.md' : file;
    const manager = new MemoryManager(ctx.projectRoot);

    try {
      const content = await manager.loadFile(resolved);
      if (content === null) {
        return {
          tool: 'read_memory',
          success: false,
          output: '',
          error: `Memory file not found: ${resolved}`,
        };
      }
      return { tool: 'read_memory', success: true, output: content };
    } catch (err) {
      return {
        tool: 'read_memory',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
