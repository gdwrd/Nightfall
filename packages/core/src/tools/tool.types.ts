import type { AgentRole } from '@nightfall/shared';

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export interface ToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  error?: string;
}

export class ToolNotAllowedError extends Error {
  constructor(tool: string, role: AgentRole) {
    super(`Tool "${tool}" is not allowed for role "${role}"`);
    this.name = 'ToolNotAllowedError';
  }
}

/** Context passed to every tool at execution time */
export interface ToolContext {
  agentId: string;
  role: AgentRole;
  projectRoot: string;
}

/** A callable tool implementation */
export interface ToolImpl {
  definition: ToolDefinition;
  execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
