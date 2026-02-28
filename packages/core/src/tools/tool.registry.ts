import type { AgentRole } from '@nightfall/shared';
import {
  type ToolImpl,
  type ToolCall,
  type ToolResult,
  type ToolContext,
  ToolNotAllowedError,
} from './tool.types.js';
import { readMemoryTool } from './tools/read_memory.js';
import { readFileTool } from './tools/read_file.js';
import { writeDiffTool } from './tools/write_diff.js';
import { runCommandTool } from './tools/run_command.js';
import { assignTaskTool } from './tools/assign_task.js';
import { requestReviewTool } from './tools/request_review.js';
import { writeMemoryTool } from './tools/write_memory.js';
import { updateIndexTool } from './tools/update_index.js';

/** Map of which tools each agent role may call */
const ROLE_TOOLS: Record<AgentRole, string[]> = {
  'team-lead': ['read_memory', 'read_file', 'assign_task', 'request_review'],
  engineer: ['read_memory', 'read_file', 'write_diff', 'run_command'],
  reviewer: ['read_memory', 'read_file', 'run_command'],
  'memory-manager': ['read_file', 'write_memory', 'update_index'],
};

const ALL_TOOLS: ToolImpl[] = [
  readMemoryTool,
  readFileTool,
  writeDiffTool,
  runCommandTool,
  assignTaskTool,
  requestReviewTool,
  writeMemoryTool,
  updateIndexTool,
];

export class ToolRegistry {
  private tools: Map<string, ToolImpl> = new Map();

  constructor() {
    for (const tool of ALL_TOOLS) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  /**
   * Execute a tool call on behalf of an agent.
   * Throws ToolNotAllowedError if the agent's role doesn't have access to the tool.
   */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const allowed = ROLE_TOOLS[ctx.role] ?? [];
    if (!allowed.includes(call.tool)) {
      throw new ToolNotAllowedError(call.tool, ctx.role);
    }

    const impl = this.tools.get(call.tool);
    if (!impl) {
      return {
        tool: call.tool,
        success: false,
        output: '',
        error: `Unknown tool: "${call.tool}"`,
      };
    }

    return impl.execute(call.parameters, ctx);
  }

  /** Returns all tool definitions available to a given role. */
  getToolsForRole(role: AgentRole): import('./tool.types.js').ToolDefinition[] {
    const allowed = ROLE_TOOLS[role] ?? [];
    return allowed
      .map((name) => this.tools.get(name)?.definition)
      .filter((d): d is import('./tool.types.js').ToolDefinition => d != null);
  }

  /** Returns all registered tool names. */
  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
