import { describe, it, expect } from 'vitest';
import { reducer } from '../app.store.js';
import type { AppState, AppPhase } from '../app.store.js';
import type { AppAction } from '../app.actions.js';
import type { TaskRun, TaskPlan, AgentState, SnapshotMeta } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInitialState(overrides: Partial<AppState> = {}): AppState {
  return {
    phase: 'lifecycle',
    lifecycleEvent: { type: 'detecting' },
    activeRun: null,
    agentStates: {},
    locks: [],
    messages: [],
    errorMessage: null,
    slashOutput: null,
    historyRuns: [],
    historySnapshots: [],
    rollbackChain: [],
    pendingRollbackSnapshotId: null,
    contextLength: null,
    modelViewData: null,
    settingsViewData: null,
    newProjectData: null,
    ...overrides,
  };
}

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

function makeTaskPlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    taskId: 'task-001',
    prompt: 'Test task',
    subtasks: [
      { id: 'st-1', description: 'Step 1', assignedTo: null, status: 'pending', filesTouched: [] },
    ],
    complexity: 'simple',
    estimatedEngineers: 1,
    ...overrides,
  };
}

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

function apply(state: AppState, action: AppAction): AppState {
  return reducer(state, action);
}

// ---------------------------------------------------------------------------
// LIFECYCLE_EVENT
// ---------------------------------------------------------------------------

describe('LIFECYCLE_EVENT', () => {
  it('sets lifecycleEvent for non-terminal events', () => {
    const state = makeInitialState();
    const next = apply(state, { type: 'LIFECYCLE_EVENT', event: { type: 'starting' } });
    expect(next.lifecycleEvent).toEqual({ type: 'starting' });
    expect(next.phase).toBe('lifecycle');
  });

  it('transitions phase to idle on model_ready', () => {
    const state = makeInitialState();
    const next = apply(state, {
      type: 'LIFECYCLE_EVENT',
      event: { type: 'model_ready', model: 'deepseek-r1', contextLength: 16384 },
    });
    expect(next.phase).toBe('idle');
    expect(next.contextLength).toBe(16384);
  });

  it('transitions phase to provider_setup on fatal', () => {
    const state = makeInitialState();
    const next = apply(state, {
      type: 'LIFECYCLE_EVENT',
      event: { type: 'fatal', message: 'Provider failed' },
    });
    expect(next.phase).toBe('provider_setup');
    expect(next.providerSetupError).toBe('Provider failed');
  });

  it('does not change phase for provider_check event', () => {
    const state = makeInitialState();
    const next = apply(state, { type: 'LIFECYCLE_EVENT', event: { type: 'provider_check' } });
    expect(next.phase).toBe('lifecycle');
    expect(next.lifecycleEvent).toEqual({ type: 'provider_check' });
  });
});

// ---------------------------------------------------------------------------
// TASK_STATUS
// ---------------------------------------------------------------------------

describe('TASK_STATUS', () => {
  it('transitions to classifying on classifying status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'classifying' }) });
    expect(next.phase).toBe('classifying');
  });

  it('transitions to planning on planning status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'planning' }) });
    expect(next.phase).toBe('planning');
  });

  it('transitions to awaiting_approval on awaiting_approval status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, {
      type: 'TASK_STATUS',
      run: makeTaskRun({ status: 'awaiting_approval' }),
    });
    expect(next.phase).toBe('awaiting_approval');
  });

  it('transitions to running on running status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'running' }) });
    expect(next.phase).toBe('running');
  });

  it('transitions to running on reviewing status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'reviewing' }) });
    expect(next.phase).toBe('running');
  });

  it('transitions to running on reworking status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'reworking' }) });
    expect(next.phase).toBe('running');
  });

  it('transitions to running on answering status', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'answering' }) });
    expect(next.phase).toBe('running');
  });

  it('transitions to answered on answered status and adds message', () => {
    const state = makeInitialState({ phase: 'running' });
    const run = makeTaskRun({ status: 'answered', answer: 'The answer is 42.' });
    const next = apply(state, { type: 'TASK_STATUS', run });
    expect(next.phase).toBe('answered');
    expect(next.messages).toContain('The answer is 42.');
  });

  it('transitions to completed on completed status', () => {
    const state = makeInitialState({ phase: 'running' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'completed' }) });
    expect(next.phase).toBe('completed');
    expect(next.messages.some((m) => m.includes('Task completed'))).toBe(true);
  });

  it('includes warnings from completed task in messages', () => {
    const state = makeInitialState({ phase: 'running' });
    const run = makeTaskRun({ status: 'completed', warnings: ['Snapshot write failed'] });
    const next = apply(state, { type: 'TASK_STATUS', run });
    expect(next.messages.some((m) => m.includes('Snapshot write failed'))).toBe(true);
  });

  it('transitions to completed on rework_limit_reached with warning message', () => {
    const state = makeInitialState({ phase: 'running' });
    const next = apply(state, {
      type: 'TASK_STATUS',
      run: makeTaskRun({ status: 'rework_limit_reached' }),
    });
    expect(next.phase).toBe('completed');
    expect(next.messages.some((m) => m.includes('Rework limit'))).toBe(true);
  });

  it('transitions to idle on cancelled status', () => {
    const state = makeInitialState({ phase: 'running' });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'cancelled' }) });
    expect(next.phase).toBe('idle');
  });

  it('does not override new_project phase with task:status', () => {
    const state = makeInitialState({
      phase: 'new_project',
      newProjectData: {
        sessionId: 'sess-1',
        status: 'gathering',
        currentQuestion: 'What do you want?',
        questionNumber: 1,
        history: [],
      },
    });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'running' }) });
    expect(next.phase).toBe('new_project');
  });

  it('caps messages at 10', () => {
    const state = makeInitialState({ messages: Array(9).fill('old message') });
    const next = apply(state, { type: 'TASK_STATUS', run: makeTaskRun({ status: 'completed' }) });
    expect(next.messages.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// AGENT_STATE
// ---------------------------------------------------------------------------

describe('AGENT_STATE', () => {
  it('adds new agent state', () => {
    const state = makeInitialState();
    const agentState = makeAgentState({ id: 'engineer-1' });
    const next = apply(state, { type: 'AGENT_STATE', state: agentState });
    expect(next.agentStates['engineer-1']).toEqual(agentState);
  });

  it('updates existing agent state', () => {
    const initial = makeAgentState({ id: 'engineer-1', status: 'thinking' });
    const state = makeInitialState({ agentStates: { 'engineer-1': initial } });
    const updated = makeAgentState({ id: 'engineer-1', status: 'done' });
    const next = apply(state, { type: 'AGENT_STATE', state: updated });
    expect(next.agentStates['engineer-1']!.status).toBe('done');
  });

  it('preserves other agent states', () => {
    const lead = makeAgentState({ id: 'team-lead', role: 'team-lead', status: 'done' });
    const engineer = makeAgentState({ id: 'engineer-1', status: 'thinking' });
    const state = makeInitialState({ agentStates: { 'team-lead': lead } });
    const next = apply(state, { type: 'AGENT_STATE', state: engineer });
    expect(next.agentStates['team-lead']).toEqual(lead);
    expect(next.agentStates['engineer-1']).toEqual(engineer);
  });
});

// ---------------------------------------------------------------------------
// LOCK_UPDATE
// ---------------------------------------------------------------------------

describe('LOCK_UPDATE', () => {
  it('replaces locks array', () => {
    const state = makeInitialState({ locks: [] });
    const locks = [{ path: 'src/foo.ts', holder: 'engineer-1', acquiredAt: 0 }];
    const next = apply(state, { type: 'LOCK_UPDATE', locks });
    expect(next.locks).toEqual(locks);
  });

  it('clears locks when empty array is provided', () => {
    const state = makeInitialState({
      locks: [{ path: 'src/foo.ts', holder: 'engineer-1', acquiredAt: 0 }],
    });
    const next = apply(state, { type: 'LOCK_UPDATE', locks: [] });
    expect(next.locks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ADD_MESSAGE / CLEAR_MESSAGES
// ---------------------------------------------------------------------------

describe('ADD_MESSAGE', () => {
  it('appends a message', () => {
    const state = makeInitialState();
    const next = apply(state, { type: 'ADD_MESSAGE', message: 'Hello' });
    expect(next.messages).toContain('Hello');
  });

  it('keeps at most 10 messages', () => {
    const state = makeInitialState({ messages: Array(10).fill('old') });
    const next = apply(state, { type: 'ADD_MESSAGE', message: 'new' });
    expect(next.messages).toHaveLength(10);
    expect(next.messages[9]).toBe('new');
  });
});

describe('CLEAR_MESSAGES', () => {
  it('empties messages array', () => {
    const state = makeInitialState({ messages: ['a', 'b', 'c'] });
    const next = apply(state, { type: 'CLEAR_MESSAGES' });
    expect(next.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SET_SLASH_OUTPUT
// ---------------------------------------------------------------------------

describe('SET_SLASH_OUTPUT', () => {
  it('sets the slash output string', () => {
    const state = makeInitialState();
    const next = apply(state, { type: 'SET_SLASH_OUTPUT', output: 'some output' });
    expect(next.slashOutput).toBe('some output');
  });

  it('clears slash output when null', () => {
    const state = makeInitialState({ slashOutput: 'old output' });
    const next = apply(state, { type: 'SET_SLASH_OUTPUT', output: null });
    expect(next.slashOutput).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SET_PHASE
// ---------------------------------------------------------------------------

describe('SET_PHASE', () => {
  const validPhases: AppPhase[] = [
    'lifecycle',
    'idle',
    'classifying',
    'planning',
    'awaiting_approval',
    'editing_plan',
    'running',
    'answered',
    'completed',
    'error',
    'history_view',
    'rollback_confirm',
    'model_view',
    'settings_view',
    'new_project',
  ];

  for (const phase of validPhases) {
    it(`transitions to ${phase} phase`, () => {
      const state = makeInitialState();
      const next = apply(state, { type: 'SET_PHASE', phase });
      expect(next.phase).toBe(phase);
    });
  }
});

// ---------------------------------------------------------------------------
// RESET_TASK
// ---------------------------------------------------------------------------

describe('RESET_TASK', () => {
  it('clears activeRun, agentStates, locks, and slashOutput', () => {
    const state = makeInitialState({
      activeRun: makeTaskRun(),
      agentStates: { 'engineer-1': makeAgentState() },
      locks: [{ path: 'src/foo.ts', holder: 'engineer-1', acquiredAt: 0 }],
      slashOutput: 'some output',
    });
    const next = apply(state, { type: 'RESET_TASK' });
    expect(next.activeRun).toBeNull();
    expect(next.agentStates).toEqual({});
    expect(next.locks).toHaveLength(0);
    expect(next.slashOutput).toBeNull();
  });

  it('preserves other state fields', () => {
    const state = makeInitialState({ phase: 'idle', messages: ['hello'] });
    const next = apply(state, { type: 'RESET_TASK' });
    expect(next.phase).toBe('idle');
    expect(next.messages).toContain('hello');
  });
});

// ---------------------------------------------------------------------------
// UPDATE_PLAN
// ---------------------------------------------------------------------------

describe('UPDATE_PLAN', () => {
  it('updates plan on activeRun', () => {
    const run = makeTaskRun({ plan: null });
    const state = makeInitialState({ activeRun: run });
    const newPlan = makeTaskPlan({ complexity: 'complex', estimatedEngineers: 2 });
    const next = apply(state, { type: 'UPDATE_PLAN', plan: newPlan });
    expect(next.activeRun!.plan).toEqual(newPlan);
  });

  it('is a no-op when activeRun is null', () => {
    const state = makeInitialState({ activeRun: null });
    const next = apply(state, { type: 'UPDATE_PLAN', plan: makeTaskPlan() });
    expect(next.activeRun).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SET_HISTORY_DATA
// ---------------------------------------------------------------------------

describe('SET_HISTORY_DATA', () => {
  it('transitions to history_view and populates runs and snapshots', () => {
    const state = makeInitialState({ phase: 'idle' });
    const runs = [makeTaskRun({ status: 'completed' })];
    const snapshots: SnapshotMeta[] = [
      { id: 'snap-1', taskId: 'task-001', createdAt: 0, files: [], basePath: '/proj' },
    ];
    const next = apply(state, { type: 'SET_HISTORY_DATA', runs, snapshots });
    expect(next.phase).toBe('history_view');
    expect(next.historyRuns).toEqual(runs);
    expect(next.historySnapshots).toEqual(snapshots);
  });
});

// ---------------------------------------------------------------------------
// SET_ROLLBACK_CHAIN
// ---------------------------------------------------------------------------

describe('SET_ROLLBACK_CHAIN', () => {
  it('transitions to rollback_confirm with chain and snapshotId', () => {
    const state = makeInitialState({ phase: 'history_view' });
    const chain: SnapshotMeta[] = [
      { id: 'snap-1', taskId: 'task-001', createdAt: 0, files: [], basePath: '/proj' },
    ];
    const next = apply(state, { type: 'SET_ROLLBACK_CHAIN', chain, snapshotId: 'snap-1' });
    expect(next.phase).toBe('rollback_confirm');
    expect(next.rollbackChain).toEqual(chain);
    expect(next.pendingRollbackSnapshotId).toBe('snap-1');
  });
});

// ---------------------------------------------------------------------------
// SET_MODEL_VIEW
// ---------------------------------------------------------------------------

describe('SET_MODEL_VIEW', () => {
  it('transitions to model_view with data', () => {
    const state = makeInitialState({ phase: 'idle' });
    const data = {
      type: 'model_view' as const,
      provider: 'ollama',
      currentModel: 'deepseek-r1',
      models: [{ id: 'deepseek-r1', label: 'DeepSeek R1' }],
    };
    const next = apply(state, { type: 'SET_MODEL_VIEW', data });
    expect(next.phase).toBe('model_view');
    expect(next.modelViewData).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// SET_SETTINGS_VIEW
// ---------------------------------------------------------------------------

describe('SET_SETTINGS_VIEW', () => {
  it('transitions to settings_view with config data', () => {
    const state = makeInitialState({ phase: 'idle' });
    const config = {
      provider: { name: 'ollama' as const, model: 'test', host: 'localhost', port: 11434 },
      concurrency: { max_engineers: 2 },
      task: { max_rework_cycles: 3, max_retries: 2, max_context_tokens: 8192 },
      logs: { retention: 7 },
    };
    const next = apply(state, { type: 'SET_SETTINGS_VIEW', data: { config } });
    expect(next.phase).toBe('settings_view');
    expect(next.settingsViewData).toEqual({ config });
  });
});

// ---------------------------------------------------------------------------
// SET_NEW_PROJECT / UPDATE_NEW_PROJECT / APPEND_NEW_PROJECT_HISTORY / CLEAR_NEW_PROJECT
// ---------------------------------------------------------------------------

describe('new project actions', () => {
  const wizardData = {
    sessionId: 'sess-1',
    status: 'gathering' as const,
    currentQuestion: 'What do you want?',
    questionNumber: 1,
    history: [],
  };

  it('SET_NEW_PROJECT transitions to new_project phase', () => {
    const state = makeInitialState({ phase: 'idle' });
    const next = apply(state, { type: 'SET_NEW_PROJECT', data: wizardData });
    expect(next.phase).toBe('new_project');
    expect(next.newProjectData).toEqual(wizardData);
  });

  it('UPDATE_NEW_PROJECT merges partial data when wizard is open', () => {
    const state = makeInitialState({ phase: 'new_project', newProjectData: wizardData });
    const next = apply(state, {
      type: 'UPDATE_NEW_PROJECT',
      partial: { status: 'compiling_spec', currentQuestion: null },
    });
    expect(next.newProjectData!.status).toBe('compiling_spec');
    expect(next.newProjectData!.currentQuestion).toBeNull();
    expect(next.newProjectData!.sessionId).toBe('sess-1');
  });

  it('UPDATE_NEW_PROJECT is a no-op when newProjectData is null', () => {
    const state = makeInitialState({ phase: 'idle', newProjectData: null });
    const next = apply(state, {
      type: 'UPDATE_NEW_PROJECT',
      partial: { status: 'gathering' },
    });
    expect(next.newProjectData).toBeNull();
  });

  it('APPEND_NEW_PROJECT_HISTORY adds an entry', () => {
    const state = makeInitialState({ phase: 'new_project', newProjectData: wizardData });
    const entry = { role: 'user' as const, content: 'My app idea' };
    const next = apply(state, { type: 'APPEND_NEW_PROJECT_HISTORY', entry });
    expect(next.newProjectData!.history).toContainEqual(entry);
  });

  it('APPEND_NEW_PROJECT_HISTORY is a no-op when newProjectData is null', () => {
    const state = makeInitialState({ newProjectData: null });
    const next = apply(state, {
      type: 'APPEND_NEW_PROJECT_HISTORY',
      entry: { role: 'user', content: 'test' },
    });
    expect(next.newProjectData).toBeNull();
  });

  it('CLEAR_NEW_PROJECT transitions to idle and clears data', () => {
    const state = makeInitialState({ phase: 'new_project', newProjectData: wizardData });
    const next = apply(state, { type: 'CLEAR_NEW_PROJECT' });
    expect(next.phase).toBe('idle');
    expect(next.newProjectData).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HISTORY_CLEARED
// ---------------------------------------------------------------------------

describe('HISTORY_CLEARED', () => {
  it('resets history runs, messages, and active run', () => {
    const state = makeInitialState({
      phase: 'idle',
      historyRuns: [makeTaskRun({ status: 'completed' })],
      messages: ['old message'],
      activeRun: makeTaskRun(),
    });
    const next = apply(state, { type: 'HISTORY_CLEARED' });
    expect(next.historyRuns).toHaveLength(0);
    expect(next.messages).toHaveLength(0);
    expect(next.activeRun).toBeNull();
    expect(next.phase).toBe('idle');
  });

  it('does not change lifecycle or error phase', () => {
    const lifecycleState = makeInitialState({ phase: 'lifecycle' });
    const lifecycleNext = apply(lifecycleState, { type: 'HISTORY_CLEARED' });
    expect(lifecycleNext.phase).toBe('lifecycle');

    const errorState = makeInitialState({ phase: 'error' });
    const errorNext = apply(errorState, { type: 'HISTORY_CLEARED' });
    expect(errorNext.phase).toBe('error');
  });

  it('returns to idle from any active phase', () => {
    const phases: AppPhase[] = ['running', 'planning', 'completed', 'answered', 'history_view'];
    for (const phase of phases) {
      const state = makeInitialState({ phase });
      const next = apply(state, { type: 'HISTORY_CLEARED' });
      expect(next.phase).toBe('idle');
    }
  });
});

// ---------------------------------------------------------------------------
// PLAN_EDIT_FAILED
// ---------------------------------------------------------------------------

describe('PLAN_EDIT_FAILED', () => {
  it('returns to awaiting_approval phase with error message', () => {
    const state = makeInitialState({ phase: 'editing_plan' });
    const next = apply(state, { type: 'PLAN_EDIT_FAILED', message: 'Editor crashed' });
    expect(next.phase).toBe('awaiting_approval');
    expect(next.messages.some((m) => m.includes('Editor crashed'))).toBe(true);
  });

  it('prepends warning symbol to editor error message', () => {
    const state = makeInitialState({ phase: 'editing_plan' });
    const next = apply(state, { type: 'PLAN_EDIT_FAILED', message: 'timeout' });
    const msg = next.messages.find((m) => m.includes('timeout'));
    expect(msg).toBeDefined();
    expect(msg!.startsWith('⚠')).toBe(true);
  });
});
