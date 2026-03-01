import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { PlanReview } from '../PlanReview.js';
import type { TaskPlan } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    taskId: 'task-001',
    prompt: 'Build a REST API',
    subtasks: [
      {
        id: 'st-1',
        description: 'Set up project structure',
        assignedTo: null,
        status: 'pending',
        filesTouched: [],
      },
      {
        id: 'st-2',
        description: 'Implement endpoints',
        assignedTo: null,
        status: 'pending',
        filesTouched: [],
      },
    ],
    complexity: 'simple',
    estimatedEngineers: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rendering tests
// ---------------------------------------------------------------------------

describe('PlanReview', () => {
  it('renders the EXECUTION PLAN header', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan()} />);
    expect(lastFrame()!).toContain('EXECUTION PLAN');
  });

  it('shows task complexity', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan({ complexity: 'simple' })} />);
    expect(lastFrame()!).toContain('simple');
  });

  it('shows complex complexity', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan({ complexity: 'complex' })} />);
    expect(lastFrame()!).toContain('complex');
  });

  it('shows singular "engineer" for 1 engineer', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan({ estimatedEngineers: 1 })} />);
    const frame = lastFrame()!;
    expect(frame).toContain('1 engineer');
    expect(frame).not.toContain('1 engineers');
  });

  it('shows plural "engineers" for multiple engineers', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan({ estimatedEngineers: 3 })} />);
    const frame = lastFrame()!;
    expect(frame).toContain('3 engineers');
  });

  it('renders all subtask descriptions', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan()} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Set up project structure');
    expect(frame).toContain('Implement endpoints');
  });

  it('renders subtask indices [1], [2], etc.', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan()} />);
    const frame = lastFrame()!;
    expect(frame).toContain('[1]');
    expect(frame).toContain('[2]');
  });

  it('shows approval options: Y, N, E', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan()} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Y');
    expect(frame).toContain('N');
    expect(frame).toContain('E');
  });

  it('shows "Approve plan?" prompt', () => {
    const { lastFrame } = render(<PlanReview plan={makePlan()} />);
    expect(lastFrame()!).toContain('Approve plan?');
  });

  it('renders a single subtask correctly', () => {
    const plan = makePlan({
      subtasks: [
        {
          id: 'st-1',
          description: 'Only task',
          assignedTo: null,
          status: 'pending',
          filesTouched: [],
        },
      ],
    });
    const { lastFrame } = render(<PlanReview plan={plan} />);
    const frame = lastFrame()!;
    expect(frame).toContain('[1]');
    expect(frame).toContain('Only task');
    expect(frame).not.toContain('[2]');
  });

  it('renders many subtasks', () => {
    const subtasks = Array.from({ length: 5 }, (_, i) => ({
      id: `st-${i + 1}`,
      description: `Task step ${i + 1}`,
      assignedTo: null,
      status: 'pending' as const,
      filesTouched: [],
    }));
    const plan = makePlan({ subtasks, estimatedEngineers: 3 });
    const { lastFrame } = render(<PlanReview plan={plan} />);
    const frame = lastFrame()!;
    expect(frame).toContain('[5]');
    expect(frame).toContain('Task step 5');
  });
});
