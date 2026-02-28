import type { ToolCall } from '../tools/tool.types.js';

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/;
const DONE_RE = /<done>\s*([\s\S]*?)\s*<\/done>/;

/**
 * Parse the first <tool_call>…</tool_call> block from an LLM response.
 * Returns null if none is found or the JSON is malformed.
 */
export function parseToolCall(response: string): ToolCall | null {
  const match = TOOL_CALL_RE.exec(response);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as { tool?: unknown; parameters?: unknown };
    if (typeof parsed.tool !== 'string') return null;
    return {
      tool: parsed.tool,
      parameters:
        parsed.parameters != null && typeof parsed.parameters === 'object'
          ? (parsed.parameters as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

export interface DoneSignal {
  summary: string;
}

/**
 * Parse a <done>…</done> completion signal from an LLM response.
 * Returns null if none is found.
 */
export function parseDone(response: string): DoneSignal | null {
  const match = DONE_RE.exec(response);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as { summary?: unknown };
    return { summary: typeof parsed.summary === 'string' ? parsed.summary : 'Done' };
  } catch {
    return null;
  }
}
