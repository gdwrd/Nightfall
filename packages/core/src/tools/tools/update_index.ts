import type { MemoryIndex, MemoryIndexEntry, MemoryComponentEntry } from '@nightfall/shared';
import { MemoryManager } from '../../memory/memory.manager.js';
import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';

export const updateIndexTool: ToolImpl = {
  definition: {
    name: 'update_index',
    description:
      'Add or update an entry in the memory index (index.md). Use this after writing a new or updated component file.',
    parameters: {
      file: {
        type: 'string',
        description: 'Relative path of the memory file being indexed (e.g. "components/auth.md").',
        required: true,
      },
      description: {
        type: 'string',
        description: "Short one-line description of the file's contents.",
        required: true,
      },
      isComponent: {
        type: 'boolean',
        description: 'Whether this file is a component file (true) or a top-level file (false).',
        required: false,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const file = String(params['file'] ?? '').trim();
    const description = String(params['description'] ?? '').trim();
    const isComponent = params['isComponent'] === true || params['isComponent'] === 'true';

    if (!file || !description) {
      return {
        tool: 'update_index',
        success: false,
        output: '',
        error: 'Missing required parameters: file, description',
      };
    }

    const manager = new MemoryManager(ctx.projectRoot);

    try {
      const index: MemoryIndex = await manager.loadIndex();

      if (isComponent) {
        const existing = index.components.findIndex((c) => c.file === file);
        const entry: MemoryComponentEntry = { file, description };
        if (existing >= 0) {
          index.components[existing] = entry;
        } else {
          index.components.push(entry);
        }
      } else {
        const existing = index.entries.findIndex((e) => e.file === file);
        const entry: MemoryIndexEntry = { file, description };
        if (existing >= 0) {
          index.entries[existing] = entry;
        } else {
          index.entries.push(entry);
        }
      }

      await manager.saveIndex(index);

      return {
        tool: 'update_index',
        success: true,
        output: `Index updated: "${file}" — ${description}`,
      };
    } catch (err) {
      return {
        tool: 'update_index',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
