import { describe, it, expect, afterEach } from 'vitest';
import { assignTaskTool, setAssignTaskBus, type AssignTaskMessage } from '../tools/assign_task.js';
import type { ToolContext } from '../tool.types.js';

const ctx = (): ToolContext => ({
  agentId: 'team-lead-1',
  role: 'team-lead',
  projectRoot: '/tmp/test',
});

afterEach(() => {
  // Reset bus to a no-op to avoid state leaking between tests
  setAssignTaskBus(() => {
    /* noop */
  });
});

describe('assign_task tool', () => {
  it('emits task assignment to the message bus', async () => {
    const messages: AssignTaskMessage[] = [];
    setAssignTaskBus((msg) => messages.push(msg));

    const result = await assignTaskTool.execute(
      { subtaskId: 'subtask-1', description: 'Write the auth module', assignedTo: 'engineer-1' },
      ctx(),
    );

    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subtaskId).toBe('subtask-1');
    expect(messages[0]!.assignedTo).toBe('engineer-1');
    expect(messages[0]!.type).toBe('ASSIGN_TASK');
    expect(messages[0]!.fromAgentId).toBe('team-lead-1');
  });

  it('returns success with subtask ID in output', async () => {
    setAssignTaskBus(() => {
      /* noop */
    });

    const result = await assignTaskTool.execute(
      { subtaskId: 'subtask-2', description: 'Add tests', assignedTo: 'engineer-2' },
      ctx(),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('subtask-2');
    expect(result.output).toContain('engineer-2');
  });

  it('returns error when required parameters are missing', async () => {
    const result = await assignTaskTool.execute({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('returns error when subtaskId is empty', async () => {
    const result = await assignTaskTool.execute(
      { subtaskId: '', description: 'do something', assignedTo: 'engineer-1' },
      ctx(),
    );
    expect(result.success).toBe(false);
  });

  it('includes a timestamp in the emitted message', async () => {
    const messages: AssignTaskMessage[] = [];
    setAssignTaskBus((msg) => messages.push(msg));

    const before = Date.now();
    await assignTaskTool.execute(
      { subtaskId: 'ts-test', description: 'timestamp check', assignedTo: 'engineer-1' },
      ctx(),
    );
    const after = Date.now();

    expect(messages[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(messages[0]!.timestamp).toBeLessThanOrEqual(after);
  });
});
