import type { ToolImpl, ToolResult, ToolContext } from '../tool.types.js';

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
        required: true,
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

    return {
      tool: 'request_review',
      success: true,
      output: `Review requested for subtask "${subtaskId}" (${filesChanged.length} file(s) changed)`,
    };
  },
};
