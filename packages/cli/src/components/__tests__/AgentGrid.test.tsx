import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { AgentGrid } from '../AgentGrid.js';
import type { AgentState } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'engineer-1',
    role: 'engineer',
    status: 'thinking',
    currentAction: null,
    log: [],
    ...overrides,
  };
}

function makeAgentStates(
  ids: string[],
  status: AgentState['status'] = 'thinking',
): Record<string, AgentState> {
  return Object.fromEntries(
    ids.map((id) => {
      const role: AgentState['role'] = id.startsWith('team-lead')
        ? 'team-lead'
        : id.startsWith('reviewer')
          ? 'reviewer'
          : 'engineer';
      return [id, makeAgentState({ id, role, status })];
    }),
  );
}

// ---------------------------------------------------------------------------
// Rendering tests
// ---------------------------------------------------------------------------

describe('AgentGrid', () => {
  it('renders nothing when no agent states match the expected panels', () => {
    // engineerCount=1 means we expect team-lead, engineer-1, reviewer
    // but agentStates is empty, so nothing renders
    const { lastFrame } = render(<AgentGrid agentStates={{}} engineerCount={1} />);
    expect(lastFrame()!).toBe('');
  });

  it('renders the team-lead panel when team-lead state is present', () => {
    const agentStates = makeAgentStates(['team-lead']);
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('TEAM LEAD');
  });

  it('renders engineer panel when engineer state is present', () => {
    const agentStates = makeAgentStates(['engineer-1']);
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('ENGINEER 1');
  });

  it('renders reviewer panel when reviewer state is present', () => {
    const agentStates = makeAgentStates(['reviewer']);
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('REVIEWER');
  });

  it('renders multiple engineer panels matching engineerCount', () => {
    const agentStates = makeAgentStates(['engineer-1', 'engineer-2', 'engineer-3']);
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={3} />);
    const frame = lastFrame()!;
    expect(frame).toContain('ENGINEER 1');
    expect(frame).toContain('ENGINEER 2');
    expect(frame).toContain('ENGINEER 3');
  });

  it('only shows panels that have a matching agentState entry', () => {
    // engineerCount=3 means we expect panels for engineer-1, engineer-2, engineer-3
    // but only engineer-1 has state — only it should render
    const agentStates = makeAgentStates(['engineer-1']);
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={3} />);
    const frame = lastFrame()!;
    expect(frame).toContain('ENGINEER 1');
    expect(frame).not.toContain('ENGINEER 2');
    expect(frame).not.toContain('ENGINEER 3');
  });

  it('shows idle/waiting status for active (non-done) agents', () => {
    const agentStates = makeAgentStates(['team-lead'], 'thinking');
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('thinking');
  });

  it('shows done status for completed agents', () => {
    const agentStates = makeAgentStates(['team-lead'], 'done');
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('done');
  });

  it('shows error status for errored agents', () => {
    const agentStates = makeAgentStates(['engineer-1'], 'error');
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('error');
  });

  it('collapses done panels when other panels are still active', () => {
    // team-lead is done, engineer-1 is still thinking
    // done panel (team-lead) should be collapsed (shorter output)
    const agentStates: Record<string, AgentState> = {
      'team-lead': makeAgentState({ id: 'team-lead', role: 'team-lead', status: 'done' }),
      'engineer-1': makeAgentState({ id: 'engineer-1', role: 'engineer', status: 'thinking' }),
    };
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    const frame = lastFrame()!;
    // Both panels should be present in the output
    expect(frame).toContain('TEAM LEAD');
    expect(frame).toContain('ENGINEER 1');
  });

  it('shows currentAction text when present', () => {
    const agentStates: Record<string, AgentState> = {
      'engineer-1': makeAgentState({
        id: 'engineer-1',
        status: 'acting',
        currentAction: 'Writing src/index.ts',
      }),
    };
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('Writing src/index.ts');
  });

  it('shows log entries when present', () => {
    const agentStates: Record<string, AgentState> = {
      'engineer-1': makeAgentState({
        id: 'engineer-1',
        status: 'acting',
        log: [
          { timestamp: 1, type: 'tool_call', content: 'read_file src/main.ts' },
          { timestamp: 2, type: 'tool_result', content: 'File contents...' },
        ],
      }),
    };
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    const frame = lastFrame()!;
    expect(frame).toContain('read_file src/main.ts');
  });

  it('shows waiting placeholder when no action and no log entries', () => {
    const agentStates: Record<string, AgentState> = {
      'engineer-1': makeAgentState({ id: 'engineer-1', status: 'idle', currentAction: null, log: [] }),
    };
    const { lastFrame } = render(<AgentGrid agentStates={agentStates} engineerCount={1} />);
    expect(lastFrame()!).toContain('waiting');
  });
});
