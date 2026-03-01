/**
 * Known context window sizes by model ID substring.
 * Used as a reference for calibration and defaults.
 * Override via `NightfallConfig.context_window`.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-r1:14b': 16_384,
  'deepseek-r1:7b': 16_384,
  'deepseek-r1:32b': 32_768,
  'llama3.1': 131_072,
  'llama3.2': 131_072,
  llama3: 8_192,
  openrouter: 32_768,
};

/**
 * Look up the known context window for a model by checking if any known key is
 * a substring of the provided `modelId`. Returns `undefined` if unknown.
 */
export function getModelContextWindow(modelId: string): number | undefined {
  const lc = modelId.toLowerCase();
  for (const [key, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lc.includes(key)) return size;
  }
  return undefined;
}

/**
 * Estimate the number of tokens in a text string.
 *
 * Strategy:
 * - Split on whitespace to count words, then multiply by 1.3 (accounts for
 *   punctuation and sub-word tokens common in code and JSON).
 * - Fall back to `ceil(chars / 4)` if the text has no whitespace at all.
 *
 * The optional `modelId` parameter is accepted for future per-model
 * calibration but does not change behaviour in the current implementation.
 */
export function estimateTokens(text: string, _modelId?: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/);
  // A single-word (no whitespace) string: fall back to char-based estimate
  if (words.length <= 1 && text.length > 0) {
    return Math.ceil(text.length / 4);
  }
  return Math.ceil(words.length * 1.3);
}
