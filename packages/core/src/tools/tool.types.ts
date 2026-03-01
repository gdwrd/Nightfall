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

/** Per-parameter schema entry, used for validation and external documentation. */
export interface ParameterSchema {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

/** ToolDefinition with an explicit parameterSchema array (array form of definition.parameters). */
export type ToolDefinitionWithSchema = ToolDefinition & {
  parameterSchema: ParameterSchema[];
};

/** Result of parameter validation. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate call parameters against a tool's parameter definitions. */
export function validateToolParams(
  params: Record<string, unknown>,
  parameterDefs: Record<string, ToolParameter>,
): ValidationResult {
  const errors: string[] = [];
  for (const [name, def] of Object.entries(parameterDefs)) {
    if (!def.required) continue;
    const value = params[name];
    if (value === undefined || value === null) {
      errors.push(`missing "${name}" (${def.type})`);
    } else if (typeof value !== def.type) {
      errors.push(`"${name}" must be ${def.type}, got ${typeof value}`);
    }
  }
  return { valid: errors.length === 0, errors };
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
  /** Optional memory namespace override. When set, memory tools use this instead of the derived project slug. */
  memoryNamespace?: string;
}

/** A callable tool implementation */
export interface ToolImpl {
  definition: ToolDefinition;
  execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
