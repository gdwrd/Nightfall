import type { AgentRole } from '@nightfall/shared';
import type { ToolImpl, ToolResult, ToolContext, ParameterSchema } from '../tool.types.js';

export interface AssignTaskMessage {
  type: 'ASSIGN_TASK';
  subtaskId: string;
  description: string;
  assignedTo: string;
  fromAgentId: string;
  timestamp: number;
}

/** Message bus handler — injected by the Task Orchestrator (Phase 11). */
let _messageBus: ((msg: AssignTaskMessage) => void) | null = null;

export function setAssignTaskBus(handler: (msg: AssignTaskMessage) => void): void {
  _messageBus = handler;
}

/** Agent message audit logger — injected by the Task Orchestrator. */
type AssignLogFn = (from: AgentRole, to: AgentRole, type: 'assign', payload: unknown) => void;
let _assignLogger: AssignLogFn | null = null;

export function setAssignTaskLogger(fn: AssignLogFn | null): void {
  _assignLogger = fn;
}

export const assignTaskTool: ToolImpl = {
  definition: {
    name: 'assign_task',
    description: 'Team Lead dispatches a subtask to an engineer agent.',
    parameters: {
      subtaskId: {
        type: 'string',
        description: 'Unique identifier for this subtask (e.g. "subtask-1").',
        required: true,
      },
      description: {
        type: 'string',
        description: 'Full description of the subtask for the engineer.',
        required: true,
      },
      assignedTo: {
        type: 'string',
        description: 'Agent ID to assign this subtask to (e.g. "engineer-1").',
        required: true,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const subtaskId = String(params['subtaskId'] ?? '').trim();
    const description = String(params['description'] ?? '').trim();
    const assignedTo = String(params['assignedTo'] ?? '').trim();

    if (!subtaskId || !description || !assignedTo) {
      return {
        tool: 'assign_task',
        success: false,
        output: '',
        error: 'Missing required parameters: subtaskId, description, assignedTo',
      };
    }

    const msg: AssignTaskMessage = {
      type: 'ASSIGN_TASK',
      subtaskId,
      description,
      assignedTo,
      fromAgentId: ctx.agentId,
      timestamp: Date.now(),
    };

    _messageBus?.(msg);
    _assignLogger?.(ctx.role, 'engineer', 'assign', { subtaskId, description, assignedTo });

    return {
      tool: 'assign_task',
      success: true,
      output: `Subtask "${subtaskId}" assigned to ${assignedTo}`,
    };
  },
};

export const parameterSchema: ParameterSchema[] = Object.entries(
  assignTaskTool.definition.parameters,
).map(([name, def]) => ({ name, ...def }));
