import type { AgentRole } from '@nightfall/shared';
import type { ToolImpl, ToolResult, ToolContext, ParameterSchema } from '../tool.types.js';

export interface RequestReviewMessage {
  type: 'REQUEST_REVIEW';
  subtaskId: string;
  summary: string;
  filesChanged: string[];
  fromAgentId: string;
  timestamp: number;
}

/** Message bus handler — injected by the Task Orchestrator (Phase 11). */
let _messageBus: ((msg: RequestReviewMessage) => void) | null = null;

export function setRequestReviewBus(handler: (msg: RequestReviewMessage) => void): void {
  _messageBus = handler;
}

/** Agent message audit logger — injected by the Task Orchestrator. */
type ReviewLogFn = (from: AgentRole, to: AgentRole, type: 'review', payload: unknown) => void;
let _reviewLogger: ReviewLogFn | null = null;

export function setRequestReviewLogger(fn: ReviewLogFn | null): void {
  _reviewLogger = fn;
}

export const requestReviewTool: ToolImpl = {
  definition: {
    name: 'request_review',
    description: 'Team Lead sends completed engineer work to the Reviewer agent.',
    parameters: {
      subtaskId: {
        type: 'string',
        description: 'ID of the completed subtask.',
        required: true,
      },
      summary: {
        type: 'string',
        description: 'Summary of what the engineer(s) did.',
        required: true,
      },
      filesChanged: {
        type: 'string',
        description: 'Comma-separated list of files that were changed.',
        required: false,
      },
    },
  },

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const subtaskId = String(params['subtaskId'] ?? '').trim();
    const summary = String(params['summary'] ?? '').trim();
    const filesChangedRaw = String(params['filesChanged'] ?? '').trim();

    if (!subtaskId || !summary) {
      return {
        tool: 'request_review',
        success: false,
        output: '',
        error: 'Missing required parameters: subtaskId, summary',
      };
    }

    const filesChanged = filesChangedRaw
      ? filesChangedRaw
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : [];

    const msg: RequestReviewMessage = {
      type: 'REQUEST_REVIEW',
      subtaskId,
      summary,
      filesChanged,
      fromAgentId: ctx.agentId,
      timestamp: Date.now(),
    };

    _messageBus?.(msg);
    _reviewLogger?.(ctx.role, 'reviewer', 'review', { subtaskId, summary, filesChanged });

    return {
      tool: 'request_review',
      success: true,
      output: `Review requested for subtask "${subtaskId}" (${filesChanged.length} file(s) changed)`,
    };
  },
};

export const parameterSchema: ParameterSchema[] = Object.entries(
  requestReviewTool.definition.parameters,
).map(([name, def]) => ({ name, ...def }));
