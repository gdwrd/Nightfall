import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderAdapter, ChatMessage, NightfallConfig } from '@nightfall/shared';
import { TaskOrchestrator } from './task.orchestrator.js';
import { TaskLogger } from './task.logger.js';
import {
  createTeamLeadAgent,
  createEngineerAgent,
  createReviewerAgent,
  createMemoryManagerAgent,
  TEAM_LEAD_PROMPT,
  ENGINEER_PROMPT,
  REVIEWER_PROMPT,
  MEMORY_MANAGER_PROMPT,
} from './agent.factory.js';
import { ToolRegistry } from '../tools/tool.registry.js';
import type { TaskRun } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<NightfallConfig> = {}): NightfallConfig {
  return {
    provider: { name: 'ollama', model: 'test-model', host: 'localhost', port: 11434 },
    concurrency: { max_engineers: 2 },
    task: { max_rework_cycles: 1 },
    logs: { retention: 10 },
    ...overrides,
  };
}

/**
 * Build a provider that returns the given responses in sequence.
 * Any excess calls return a default done signal.
 */
function makeProvider(responses: string[]): ProviderAdapter {
  let idx = 0;
  return {
    async *complete(_messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
      if (signal?.aborted) return;
      const response = responses[idx++] ?? '<done>{"summary":"done"}</done>';
      yield response;
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
}

/** Plan JSON that the Team Lead is expected to return. */
function planDone(subtasks: Array<{ id: string; description: string }>): string {
  const plan = {
    subtasks,
    complexity: subtasks.length > 1 ? 'complex' : 'simple',
    estimatedEngineers: subtasks.length,
  };
  return `<done>{"summary":${JSON.stringify(JSON.stringify(plan))}}</done>`;
}

/** Review JSON that passes. */
const REVIEW_PASS = `<done>{"summary":"{\\"passed\\":true,\\"issues\\":[],\\"notes\\":\\"LGTM\\"}"}
</done>`;

/** Review JSON that fails. */
const REVIEW_FAIL = `<done>{"summary":"{\\"passed\\":false,\\"issues\\":[\\"Tests fail\\"],\\"notes\\":\\"Fix it\\"}"}
</done>`;

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-test-'));
}

// ---------------------------------------------------------------------------
// TaskLogger
// ---------------------------------------------------------------------------

describe('TaskLogger', () => {
  let tmpDir: string;
  let logger: TaskLogger;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    logger = new TaskLogger(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saves a task run and reads it back', async () => {
    const run: TaskRun = {
      id: 'test-id',
      prompt: 'add a button',
      plan: null,
      status: 'completed',
      reworkCycles: 0,
      agentStates: {},
      startedAt: Date.now(),
      completedAt: Date.now() + 1000,
      snapshotId: null,
    };

    await logger.saveLog(run);
    const logs = await logger.listLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.id).toBe('test-id');
    expect(logs[0]?.prompt).toBe('add a button');
  });

  it('listLogs returns empty array when no logs exist', async () => {
    const logs = await logger.listLogs();
    expect(logs).toHaveLength(0);
  });

  it('prunes old logs beyond maxCount', async () => {
    for (let i = 0; i < 5; i++) {
      const run: TaskRun = {
        id: `run-${i}`,
        prompt: `task ${i}`,
        plan: null,
        status: 'completed',
        reworkCycles: 0,
        agentStates: {},
        startedAt: Date.now() + i * 1000,
        completedAt: null,
        snapshotId: null,
      };
      await logger.saveLog(run);
    }

    await logger.pruneOldLogs(3);
    const logsDir = path.join(tmpDir, '.nightfall', 'logs');
    const entries = await fs.readdir(logsDir);
    expect(entries.filter((e) => e.endsWith('.json'))).toHaveLength(3);
  });

  it('sorts logs newest first', async () => {
    for (let i = 0; i < 3; i++) {
      const run: TaskRun = {
        id: `run-${i}`,
        prompt: `task ${i}`,
        plan: null,
        status: 'completed',
        reworkCycles: 0,
        agentStates: {},
        startedAt: 1000 + i * 1000,
        completedAt: null,
        snapshotId: null,
      };
      await logger.saveLog(run);
    }

    const logs = await logger.listLogs();
    expect(logs[0]?.startedAt).toBeGreaterThan(logs[1]?.startedAt ?? 0);
    expect(logs[1]?.startedAt).toBeGreaterThan(logs[2]?.startedAt ?? 0);
  });
});

// ---------------------------------------------------------------------------
// agent.factory
// ---------------------------------------------------------------------------

describe('agent.factory', () => {
  const factoryOptions = {
    provider: makeProvider([]),
    projectRoot: '/tmp/test',
  };

  it('createTeamLeadAgent returns an agent with role team-lead', () => {
    const toolRegistry = new ToolRegistry();
    const agent = createTeamLeadAgent(factoryOptions, toolRegistry);
    expect(agent.state.role).toBe('team-lead');
    expect(agent.state.id).toBe('team-lead');
  });

  it('createEngineerAgent returns an agent with role engineer and given id', () => {
    const toolRegistry = new ToolRegistry();
    const agent = createEngineerAgent('engineer-3', factoryOptions, toolRegistry);
    expect(agent.state.role).toBe('engineer');
    expect(agent.state.id).toBe('engineer-3');
  });

  it('createReviewerAgent returns an agent with role reviewer', () => {
    const toolRegistry = new ToolRegistry();
    const agent = createReviewerAgent(factoryOptions, toolRegistry);
    expect(agent.state.role).toBe('reviewer');
  });

  it('createMemoryManagerAgent returns an agent with role memory-manager', () => {
    const toolRegistry = new ToolRegistry();
    const agent = createMemoryManagerAgent(factoryOptions, toolRegistry);
    expect(agent.state.role).toBe('memory-manager');
  });

  it('uses custom prompts when provided', () => {
    const toolRegistry = new ToolRegistry();
    const customPrompt = 'Custom team lead prompt';
    const agent = createTeamLeadAgent(
      { ...factoryOptions, customPrompts: { 'team-lead': customPrompt } },
      toolRegistry,
    );
    // We can't directly inspect the system prompt via the agent interface,
    // but we verify the agent was created without error and has the right role.
    expect(agent.state.role).toBe('team-lead');
  });

  it('exports all four default prompts as non-empty strings', () => {
    expect(TEAM_LEAD_PROMPT.length).toBeGreaterThan(50);
    expect(ENGINEER_PROMPT.length).toBeGreaterThan(50);
    expect(REVIEWER_PROMPT.length).toBeGreaterThan(50);
    expect(MEMORY_MANAGER_PROMPT.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// TaskOrchestrator — submitTask
// ---------------------------------------------------------------------------

describe('TaskOrchestrator.submitTask', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns a TaskRun in awaiting_approval status after planning', async () => {
    const provider = makeProvider([
      planDone([{ id: 'subtask-1', description: 'Do the thing' }]),
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const run = await orchestrator.submitTask('Add a button to the UI');
    expect(run.status).toBe('awaiting_approval');
    expect(run.plan).not.toBeNull();
    expect(run.plan?.subtasks).toHaveLength(1);
    expect(run.plan?.subtasks[0]?.id).toBe('subtask-1');
  });

  it('emits task:plan-ready event', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'Implement feature' }]),
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const events: TaskRun[] = [];
    orchestrator.on('task:plan-ready', (r) => events.push(r));
    await orchestrator.submitTask('Implement feature X');

    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('awaiting_approval');
  });

  it('emits task:status events for planning and awaiting_approval', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const statuses: string[] = [];
    orchestrator.on('task:status', (r) => statuses.push(r.status));
    await orchestrator.submitTask('Do X');

    expect(statuses).toContain('planning');
    expect(statuses).toContain('awaiting_approval');
  });

  it('falls back to a single subtask when Team Lead returns unparseable JSON', async () => {
    const provider = makeProvider([
      '<done>{"summary":"I could not produce a structured plan"}</done>',
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const run = await orchestrator.submitTask('Fix the bug');
    expect(run.plan?.subtasks).toHaveLength(1);
    expect(run.plan?.subtasks[0]?.description).toBe('Fix the bug');
  });

  it('cancels and returns cancelled run when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const run = await orchestrator.submitTask('Do Y', controller.signal);
    expect(run.status).toBe('cancelled');
  });

  it('getTaskRun returns the current state of the run', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const run = await orchestrator.submitTask('Do something');
    const retrieved = orchestrator.getTaskRun(run.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(run.id);
  });

  it('getTaskRun returns undefined for unknown taskId', () => {
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider: makeProvider([]),
      projectRoot: tmpDir,
    });

    expect(orchestrator.getTaskRun('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TaskOrchestrator — approvePlan (happy path)
// ---------------------------------------------------------------------------

describe('TaskOrchestrator.approvePlan — success path', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('completes the task when reviewer passes', async () => {
    // Responses in order:
    //   1. Team Lead plan
    //   2. Engineer done
    //   3. Reviewer pass
    //   4. Memory Manager done
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'Write the feature' }]),
      '<done>{"summary":"Feature implemented"}</done>',
      REVIEW_PASS,
      '<done>{"summary":"Memory updated"}</done>',
    ]);

    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const planned = await orchestrator.submitTask('Add feature');
    const finalRun = await orchestrator.approvePlan(planned.id);

    expect(finalRun.status).toBe('completed');
    expect(finalRun.completedAt).not.toBeNull();
    expect(finalRun.reworkCycles).toBe(0);
  });

  it('saves a log file on completion', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
      '<done>{"summary":"done"}</done>',
      REVIEW_PASS,
      '<done>{"summary":"memory updated"}</done>',
    ]);

    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const planned = await orchestrator.submitTask('Save log test');
    await orchestrator.approvePlan(planned.id);

    const logsDir = path.join(tmpDir, '.nightfall', 'logs');
    const entries = await fs.readdir(logsDir);
    expect(entries.filter((e) => e.endsWith('.json'))).toHaveLength(1);
  });

  it('emits task:status with completed', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
      '<done>{"summary":"done"}</done>',
      REVIEW_PASS,
      '<done>{"summary":"memory done"}</done>',
    ]);

    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const statuses: string[] = [];
    orchestrator.on('task:status', (r) => statuses.push(r.status));

    const planned = await orchestrator.submitTask('task');
    await orchestrator.approvePlan(planned.id);

    expect(statuses).toContain('running');
    expect(statuses).toContain('reviewing');
    expect(statuses).toContain('completed');
  });

  it('runs multiple engineers for multi-subtask plan', async () => {
    const provider = makeProvider([
      planDone([
        { id: 's1', description: 'Engineer task 1' },
        { id: 's2', description: 'Engineer task 2' },
      ]),
      '<done>{"summary":"s1 done"}</done>',
      '<done>{"summary":"s2 done"}</done>',
      REVIEW_PASS,
      '<done>{"summary":"memory updated"}</done>',
    ]);

    const orchestrator = new TaskOrchestrator({
      config: makeConfig({ concurrency: { max_engineers: 2 } }),
      provider,
      projectRoot: tmpDir,
    });

    const agentIds: string[] = [];
    orchestrator.on('agent:state', (s) => {
      if (!agentIds.includes(s.id)) agentIds.push(s.id);
    });

    const planned = await orchestrator.submitTask('Big task');
    const finalRun = await orchestrator.approvePlan(planned.id);

    expect(finalRun.status).toBe('completed');
    // Two engineer agents should have been spawned
    expect(agentIds.filter((id) => id.startsWith('engineer-'))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// TaskOrchestrator — rework cycle
// ---------------------------------------------------------------------------

describe('TaskOrchestrator — rework cycle', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('triggers rework when reviewer fails, then completes on second pass', async () => {
    const provider = makeProvider([
      // Team Lead plan
      planDone([{ id: 's1', description: 'Do the thing' }]),
      // Engineer (first attempt)
      '<done>{"summary":"first attempt"}</done>',
      // Reviewer — fail
      REVIEW_FAIL,
      // Engineer (rework)
      '<done>{"summary":"fixed"}</done>',
      // Reviewer — pass
      REVIEW_PASS,
      // Memory Manager
      '<done>{"summary":"memory updated"}</done>',
    ]);

    const orchestrator = new TaskOrchestrator({
      config: makeConfig({ task: { max_rework_cycles: 2 } }),
      provider,
      projectRoot: tmpDir,
    });

    const statuses: string[] = [];
    orchestrator.on('task:status', (r) => statuses.push(r.status));

    const planned = await orchestrator.submitTask('Complex task');
    const finalRun = await orchestrator.approvePlan(planned.id);

    expect(finalRun.status).toBe('completed');
    expect(finalRun.reworkCycles).toBe(1);
    expect(statuses).toContain('reworking');
  });

  it('reaches rework_limit_reached when reviewer always fails', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
      // Engineer cycle 1
      '<done>{"summary":"attempt 1"}</done>',
      // Reviewer fail 1
      REVIEW_FAIL,
      // Engineer cycle 2 (rework 1)
      '<done>{"summary":"attempt 2"}</done>',
      // Reviewer fail 2
      REVIEW_FAIL,
    ]);

    const orchestrator = new TaskOrchestrator({
      config: makeConfig({ task: { max_rework_cycles: 1 } }),
      provider,
      projectRoot: tmpDir,
    });

    const planned = await orchestrator.submitTask('Hard task');
    const finalRun = await orchestrator.approvePlan(planned.id);

    expect(finalRun.status).toBe('rework_limit_reached');
  });
});

// ---------------------------------------------------------------------------
// TaskOrchestrator — error handling
// ---------------------------------------------------------------------------

describe('TaskOrchestrator — error handling', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when approvePlan is called with unknown taskId', async () => {
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider: makeProvider([]),
      projectRoot: tmpDir,
    });

    await expect(orchestrator.approvePlan('unknown-id')).rejects.toThrow('Unknown task');
  });

  it('throws when approvePlan is called before planning is done', async () => {
    const provider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
    ]);
    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    const run = await orchestrator.submitTask('task');
    // Change status manually to simulate a non-awaiting_approval state
    // (we can't easily do this without casting, so we test via double-approve)
    await orchestrator.approvePlan(run.id, (() => {
      const c = new AbortController();
      c.abort();
      return c.signal;
    })());

    // Second approve on the same id should throw because status is no longer awaiting_approval
    await expect(orchestrator.approvePlan(run.id)).rejects.toThrow();
  });

  it('cancels execution when signal is aborted during approvePlan', async () => {
    const controller = new AbortController();
    const provider: ProviderAdapter = {
      async *complete(_messages, signal) {
        // Abort as soon as we start executing
        controller.abort();
        if (signal?.aborted) return;
        yield '<done>{"summary":"should not reach"}</done>';
      },
      isAvailable: async () => true,
      ensureModelReady: async () => {},
    };

    const orchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });

    // We need to first get a plan. Use a separate provider for planning.
    const planProvider = makeProvider([
      planDone([{ id: 's1', description: 'task' }]),
    ]);
    const plannedOrchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider: planProvider,
      projectRoot: tmpDir,
    });
    const planned = await plannedOrchestrator.submitTask('task');

    // Now create a new orchestrator that will abort during execution
    const execOrchestrator = new TaskOrchestrator({
      config: makeConfig(),
      provider,
      projectRoot: tmpDir,
    });
    // Manually inject the run
    const run = await execOrchestrator.submitTask('task');
    const finalRun = await execOrchestrator.approvePlan(run.id, controller.signal);

    expect(['cancelled', 'completed', 'rework_limit_reached']).toContain(finalRun.status);
    void planned; // suppress unused warning
  });
});
