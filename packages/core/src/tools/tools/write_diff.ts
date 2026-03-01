import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyPatch } from 'diff';
import type { LockRegistry } from '../../locks/lock.registry.js';
import type { ToolImpl, ToolResult, ToolContext, ParameterSchema } from '../tool.types.js';
import { resolveAndValidatePath } from './path.utils.js';

let _lockRegistry: LockRegistry | null = null;

/** Inject the shared LockRegistry before using write_diff. */
export function setLockRegistry(registry: LockRegistry): void {
  _lockRegistry = registry;
}

export const writeDiffTool: ToolImpl = {
  definition: {
    name: 'write_diff',
    description:
      'Apply a unified diff to a file. Acquires a file lock before writing and releases it after.',
    parameters: {
      path: {
        type: 'string',
        description: 'Absolute or project-relative path to the file to patch.',
        required: true,
      },
      diff: {
        type: 'string',
        description: 'Unified diff string (output of `diff -u` or similar).',
        required: true,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = String(params['path'] ?? '').trim();
    const diffText = String(params['diff'] ?? '').trim();

    if (!filePath) {
      return {
        tool: 'write_diff',
        success: false,
        output: '',
        error: 'Missing required parameter: path',
      };
    }
    if (!diffText) {
      return {
        tool: 'write_diff',
        success: false,
        output: '',
        error: 'Missing required parameter: diff',
      };
    }

    let resolved: string;
    try {
      resolved = resolveAndValidatePath(filePath, ctx.projectRoot);
    } catch (err) {
      return {
        tool: 'write_diff',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const registry = _lockRegistry;

    // Acquire lock
    if (registry) {
      await registry.acquireLock(resolved, ctx.agentId);
    }

    try {
      let original: string;
      try {
        original = await fs.readFile(resolved, 'utf-8');
      } catch (_err) {
        // File might not exist yet; start from empty
        original = '';
      }

      const patched = applyPatch(original, diffText);

      if (patched === false) {
        throw new Error('Patch did not apply cleanly — the diff may be stale or malformed');
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, patched, 'utf-8');

      return {
        tool: 'write_diff',
        success: true,
        output: `Patch applied successfully to ${filePath}`,
      };
    } catch (err) {
      return {
        tool: 'write_diff',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (registry) {
        try {
          registry.releaseLock(resolved, ctx.agentId);
        } catch (_err) {
          // Ignore release errors — lock may have already been auto-released by deadlock watcher
        }
      }
    }
  },
};

export const parameterSchema: ParameterSchema[] = Object.entries(
  writeDiffTool.definition.parameters,
).map(([name, def]) => ({ name, ...def }));
