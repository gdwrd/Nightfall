import { MemoryManager } from '../../memory/memory.manager.js';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';

export const writeMemoryTool: ToolImpl = {
  definition: {
    name: 'write_memory',
    description: 'Write or update a memory bank file (relative to .nightfall/memory/).',
    parameters: {
      file: {
        type: 'string',
        description: 'Relative path within .nightfall/memory/ (e.g. "components/auth.md").',
        required: true,
      },
      content: {
        type: 'string',
        description: 'New content to write to the memory file.',
        required: true,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const file = String(params['file'] ?? '').trim();
    const content = String(params['content'] ?? '');

    if (!file) {
      return {
        tool: 'write_memory',
        success: false,
        output: '',
        error: 'Missing required parameter: file',
      };
    }

    const manager = new MemoryManager(ctx.projectRoot);

    try {
      await manager.updateFile(file, content);
      return { tool: 'write_memory', success: true, output: `Memory file "${file}" updated` };
    } catch (err) {
      return {
        tool: 'write_memory',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
