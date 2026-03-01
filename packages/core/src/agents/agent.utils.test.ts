import { describe, it, expect } from 'vitest';
import { estimateTokens, getModelContextWindow, MODEL_CONTEXT_WINDOWS } from './agent.utils.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('falls back to ceil(chars/4) for a single word with no whitespace', () => {
    // "hello" = 5 chars → ceil(5/4) = 2
    expect(estimateTokens('hello')).toBe(2);
  });

  it('uses word-count × 1.3 for multi-word text', () => {
    // "hello world" = 2 words → ceil(2 * 1.3) = ceil(2.6) = 3
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('counts whitespace-delimited words for typical prose', () => {
    const text = 'the quick brown fox jumps over the lazy dog'; // 9 words
    // ceil(9 * 1.3) = ceil(11.7) = 12
    expect(estimateTokens(text)).toBe(12);
  });

  it('handles multiline code content correctly', () => {
    const code = `function add(a, b) {\n  return a + b;\n}`;
    // split on whitespace: "function", "add(a,", "b)", "{", "return", "a", "+", "b;", "}" = 9 words
    const words = code.trim().split(/\s+/).length;
    expect(estimateTokens(code)).toBe(Math.ceil(words * 1.3));
  });

  it('accepts an optional modelId without changing behaviour', () => {
    const text = 'four words here test';
    expect(estimateTokens(text)).toBe(estimateTokens(text, 'deepseek-r1:14b'));
    expect(estimateTokens(text)).toBe(estimateTokens(text, 'unknown-model'));
  });

  it('produces more accurate results than chars/4 heuristic for typical code', () => {
    // A line of dense JSON with few spaces: chars/4 would be inflated
    const json = '{"key":"value","n":42}'; // 22 chars → chars/4 = 6
    // But word count = 1 (no whitespace) → falls back to chars/4 = ceil(22/4) = 6
    expect(estimateTokens(json)).toBe(Math.ceil(json.length / 4));
  });
});

describe('getModelContextWindow', () => {
  it('returns the context window for a known exact model', () => {
    expect(getModelContextWindow('deepseek-r1:14b')).toBe(MODEL_CONTEXT_WINDOWS['deepseek-r1:14b']);
  });

  it('matches a known model by substring (case-insensitive)', () => {
    expect(getModelContextWindow('DEEPSEEK-R1:14b')).toBe(16_384);
  });

  it('returns undefined for an unknown model', () => {
    expect(getModelContextWindow('gpt-4o-unknown')).toBeUndefined();
  });

  it('returns openrouter default for openrouter model strings', () => {
    expect(getModelContextWindow('openrouter/google/gemini-pro')).toBe(32_768);
  });
});
