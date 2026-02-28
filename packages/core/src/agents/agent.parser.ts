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
 *
 * Supports two formats:
 *  - Legacy: {"summary": "string"} — returns the summary string directly.
 *  - Structured: any other JSON object — returns the raw JSON string so the
 *    orchestrator can parse it with role-specific logic (no double-encoding).
 *  - Plain text: returned as-is.
 */
export function parseDone(response: string): DoneSignal | null {
  const match = DONE_RE.exec(response);
  if (!match) return null;

  const raw = match[1].trim();

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Legacy single-field format {"summary": "..."} — unwrap the string.
    if (typeof parsed['summary'] === 'string' && Object.keys(parsed).length === 1) {
      return { summary: parsed['summary'] };
    }
    // Structured role-specific format — pass raw JSON through unchanged so
    // parsePlan / parseReviewResult / etc. can consume it without double-encoding.
    return { summary: raw };
  } catch {
    // Plain text or malformed JSON — use raw content as summary.
    return { summary: raw };
  }
}
