import { describe, it, expect } from 'vitest';
import { memoryHandler } from '../memory.handler.js';

describe('memoryHandler', () => {
  it('returns a string', () => {
    const result = memoryHandler();
    expect(typeof result).toBe('string');
  });

  it('contains /memory command reference', () => {
    const result = memoryHandler();
    expect(result).toContain('/memory');
  });

  it('instructs user to submit a task to update memory', () => {
    const result = memoryHandler();
    expect(result).toContain('update memory bank');
  });

  it('returns the same string every call (no side effects)', () => {
    const result1 = memoryHandler();
    const result2 = memoryHandler();
    expect(result1).toBe(result2);
  });

  it('takes no parameters', () => {
    // memoryHandler should be callable with no arguments
    expect(() => memoryHandler()).not.toThrow();
  });
});
