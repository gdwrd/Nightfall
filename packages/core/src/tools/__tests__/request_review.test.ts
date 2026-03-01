import { describe, it, expect, afterEach } from 'vitest';
import {
  requestReviewTool,
  setRequestReviewBus,
  type RequestReviewMessage,
} from '../tools/request_review.js';
import type { ToolContext } from '../tool.types.js';

const ctx = (): ToolContext => ({
  agentId: 'team-lead-1',
  role: 'team-lead',
  projectRoot: '/tmp/test',
});

afterEach(() => {
  setRequestReviewBus(() => {
    /* noop */
  });
});

describe('request_review tool', () => {
  it('emits review request to the message bus', async () => {
    const messages: RequestReviewMessage[] = [];
    setRequestReviewBus((msg) => messages.push(msg));

    const result = await requestReviewTool.execute(
      {
        subtaskId: 'subtask-1',
        summary: 'Implemented auth module',
        filesChanged: 'src/auth.ts,src/auth.test.ts',
      },
      ctx(),
    );

    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subtaskId).toBe('subtask-1');
    expect(messages[0]!.summary).toBe('Implemented auth module');
    expect(messages[0]!.filesChanged).toEqual(['src/auth.ts', 'src/auth.test.ts']);
    expect(messages[0]!.type).toBe('REQUEST_REVIEW');
    expect(messages[0]!.fromAgentId).toBe('team-lead-1');
  });

  it('returns success with file count in output', async () => {
    setRequestReviewBus(() => {
      /* noop */
    });

    const result = await requestReviewTool.execute(
      {
        subtaskId: 'subtask-2',
        summary: 'Added new component',
        filesChanged: 'src/Button.tsx,src/Button.test.tsx,src/styles.css',
      },
      ctx(),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('subtask-2');
    expect(result.output).toContain('3');
  });

  it('returns error when required parameters are missing', async () => {
    const result = await requestReviewTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('handles empty filesChanged gracefully', async () => {
    const messages: RequestReviewMessage[] = [];
    setRequestReviewBus((msg) => messages.push(msg));

    const result = await requestReviewTool.execute(
      { subtaskId: 'sub-3', summary: 'No file changes', filesChanged: '' },
      ctx(),
    );

    expect(result.success).toBe(true);
    expect(messages[0]!.filesChanged).toEqual([]);
  });

  it('includes a timestamp in the emitted message', async () => {
    const messages: RequestReviewMessage[] = [];
    setRequestReviewBus((msg) => messages.push(msg));

    const before = Date.now();
    await requestReviewTool.execute(
      { subtaskId: 'ts-test', summary: 'timestamp check', filesChanged: '' },
      ctx(),
    );
    const after = Date.now();

    expect(messages[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(messages[0]!.timestamp).toBeLessThanOrEqual(after);
  });
});
