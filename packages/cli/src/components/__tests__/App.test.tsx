import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { App } from '../App.js';
import type { IOrchestrator } from '../../ws.client.js';
import type { NightfallConfig, TaskRun, AgentState, FileLock } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Mock orchestrator
// ---------------------------------------------------------------------------

class MockOrchestrator extends EventEmitter implements IOrchestrator {
  submitTask = vi.fn().mockResolvedValue({} as TaskRun);
  approvePlan = vi.fn().mockResolvedValue({} as TaskRun);
  getLocks = vi.fn().mockReturnValue([] as FileLock[]);
  sendSlashCommand = vi.fn();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: NightfallConfig = {
  provider: { name: 'ollama', model: 'deepseek-r1', host: 'localhost', port: 11434 },
  concurrency: { max_engineers: 2 },
  task: { max_rework_cycles: 3, max_retries: 2, max_context_tokens: 8192 },
  logs: { retention: 7 },
};

function makeTaskRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'task-001',
    prompt: 'Test task',
    plan: null,
    status: 'planning',
    reworkCycles: 0,
    agentStates: {},
    startedAt: Date.now(),
    completedAt: null,
    snapshotId: null,
    requestType: 'coding_task',
    answer: null,
    ...overrides,
  };
}

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'team-lead',
    role: 'team-lead',
    status: 'thinking',
    currentAction: 'Drafting plan',
    log: [],
    ...overrides,
  };
}

// Let effects run in ink's test renderer (useEffect fires after first render)
function flushEffects(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App', () => {
  let orchestrator: MockOrchestrator;

  beforeEach(() => {
    orchestrator = new MockOrchestrator();
  });

  it('renders LifecycleView on startup (phase=lifecycle)', () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );
    // Initial state: phase=lifecycle → LifecycleView with 'detecting' event
    const frame = lastFrame()!;
    expect(frame).toContain('NIGHTFALL');
    expect(frame).toContain('Detecting provider');
    unmount();
  });

  it('transitions to idle UI after model_ready lifecycle event', async () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );

    // Wait for useEffect to register listeners
    await flushEffects();

    // Emit model_ready event — triggers LIFECYCLE_EVENT dispatch → phase=idle
    orchestrator.emit('lifecycle', {
      type: 'model_ready',
      model: 'deepseek-r1',
      contextLength: 16384,
    });

    // Wait for re-render
    await flushEffects();

    const frame = lastFrame()!;
    // In idle phase, App renders the main layout with Header showing model name
    expect(frame).toContain('deepseek-r1');
    unmount();
  });

  it('shows ThinkingPanel during agent execution (planning phase)', async () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );

    await flushEffects();

    // First transition to idle
    orchestrator.emit('lifecycle', { type: 'model_ready', model: 'deepseek-r1' });
    await flushEffects();

    // Then transition to planning via task:status
    const run = makeTaskRun({ status: 'planning' });
    orchestrator.emit('task:status', run);
    await flushEffects();

    // Add an agent state so ThinkingPanel renders agent info
    const agentState = makeAgentState({
      id: 'team-lead',
      role: 'team-lead',
      status: 'thinking',
      currentAction: 'Analyzing the task',
    });
    orchestrator.emit('agent:state', agentState);
    await flushEffects();

    const frame = lastFrame()!;
    // ThinkingPanel should be visible with the agent id
    expect(frame).toContain('team-lead');
    unmount();
  });

  it('handles WS disconnect gracefully by adding error message', async () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );

    await flushEffects();

    // Transition to idle first
    orchestrator.emit('lifecycle', { type: 'model_ready', model: 'deepseek-r1' });
    await flushEffects();

    // Emit ws:error event
    orchestrator.emit('ws:error', new Error('WebSocket connection lost'));
    await flushEffects();

    const frame = lastFrame()!;
    // The error message should appear in the message log
    expect(frame).toContain('Connection error');
    expect(frame).toContain('WebSocket connection lost');
    unmount();
  });

  it('shows provider_error lifecycle event with error panel', async () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );

    await flushEffects();

    // Emit a provider_error lifecycle event
    orchestrator.emit('lifecycle', {
      type: 'provider_error',
      error: 'Ollama is not running on localhost:11434',
    });
    await flushEffects();

    const frame = lastFrame()!;
    // LifecycleView renders the error message
    expect(frame).toContain('Ollama is not running on localhost:11434');
    unmount();
  });

  it('shows fatal error panel when fatal lifecycle event received', async () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );

    await flushEffects();

    // Emit a fatal event — transitions phase to 'error' and sets errorMessage
    orchestrator.emit('lifecycle', {
      type: 'fatal',
      message: 'Unrecoverable startup failure',
    });
    await flushEffects();

    const frame = lastFrame()!;
    // App renders the fatal error panel
    expect(frame).toContain('Fatal error');
    expect(frame).toContain('Unrecoverable startup failure');
    unmount();
  });

  it('shows completed task message after task completion', async () => {
    const { lastFrame, unmount } = render(
      <App
        config={mockConfig}
        orchestrator={orchestrator}
        projectRoot="/tmp/test-project"
        memoryInitialized={false}
      />,
    );

    await flushEffects();

    orchestrator.emit('lifecycle', { type: 'model_ready', model: 'deepseek-r1' });
    await flushEffects();

    const completedRun = makeTaskRun({ status: 'completed' });
    orchestrator.emit('task:status', completedRun);
    await flushEffects();

    const frame = lastFrame()!;
    expect(frame).toContain('Task completed');
    unmount();
  });
});
