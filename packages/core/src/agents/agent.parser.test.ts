import { describe, it, expect } from 'vitest';
import { parseToolCall, parseDone } from './agent.parser.js';

describe('parseToolCall', () => {
  it('parses a valid tool call with parameters', () => {
    const response =
      '<tool_call>\n{"tool":"read_file","parameters":{"path":"src/index.ts"}}\n</tool_call>';
    expect(parseToolCall(response)).toEqual({
      tool: 'read_file',
      parameters: { path: 'src/index.ts' },
    });
  });

  it('parses a tool call with no parameters field', () => {
    const response = '<tool_call>{"tool":"read_memory"}</tool_call>';
    expect(parseToolCall(response)).toEqual({ tool: 'read_memory', parameters: {} });
  });

  it('parses a tool call embedded in surrounding prose', () => {
    const response =
      'I will read the file now.\n<tool_call>{"tool":"read_file","parameters":{"path":"a.ts"}}</tool_call>\nDone.';
    expect(parseToolCall(response)).toEqual({
      tool: 'read_file',
      parameters: { path: 'a.ts' },
    });
  });

  it('returns null when no tool_call block is present', () => {
    expect(parseToolCall('I have finished the task.')).toBeNull();
  });

  it('returns null for a malformed JSON block', () => {
    expect(parseToolCall('<tool_call>not valid json</tool_call>')).toBeNull();
  });

  it('returns null when "tool" field is missing', () => {
    expect(parseToolCall('<tool_call>{"parameters":{}}</tool_call>')).toBeNull();
  });

  it('returns null when "tool" field is not a string', () => {
    expect(parseToolCall('<tool_call>{"tool":42}</tool_call>')).toBeNull();
  });
});

describe('parseDone', () => {
  it('parses a valid done signal', () => {
    const response = '<done>\n{"summary":"Task completed successfully"}\n</done>';
    expect(parseDone(response)).toEqual({ summary: 'Task completed successfully' });
  });

  it('parses done embedded in surrounding text', () => {
    const response = 'Great, all done.\n<done>{"summary":"Files updated"}</done>';
    expect(parseDone(response)).toEqual({ summary: 'Files updated' });
  });

  it('passes structured JSON through as raw summary when no string summary field', () => {
    const result = parseDone('<done>{}</done>');
    expect(result?.summary).toBe('{}');
  });

  it('passes structured JSON through when summary is not a string', () => {
    const result = parseDone('<done>{"summary":42}</done>');
    expect(result?.summary).toBe('{"summary":42}');
  });

  it('returns null when no done block is present', () => {
    expect(parseDone('Still working on it.')).toBeNull();
  });

  it('uses plain text as summary for non-JSON content', () => {
    const result = parseDone('<done>broken json</done>');
    expect(result?.summary).toBe('broken json');
  });
});
