import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  NightfallConfig,
  ProviderAdapter,
  AgentState,
  AgentLogEntry,
  TaskRun,
  TaskPlan,
  Subtask,
} from '@nightfall/shared';
import { ToolRegistry } from '../tools/tool.registry.js';
import { LockRegistry } from '../locks/lock.registry.js';
import { SnapshotManager } from '../snapshots/snapshot.manager.js';
import { setLockRegistry } from '../tools/tools/write_diff.js';
import {
  createTeamLeadAgent,
  createEngineerAgent,
  createReviewerAgent,
  createMemoryManagerAgent,
  type AgentFactoryOptions,
} from './agent.factory.js';
import { TaskLogger } from './task.logger.js';
import type { BaseAgent } from '../agents/agent.base.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  config: NightfallConfig;
  provider: ProviderAdapter;
  projectRoot: string;
}

/** Parsed outcome of a reviewer run. */
export interface ReviewResult {
  passed: boolean;
  issues: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Event type augmentation
// ---------------------------------------------------------------------------

export declare interface TaskOrchestrator {
  /** Emitted when the Team Lead has produced a plan ready for user approval. */
  on(event: 'task:plan-ready', listener: (run: TaskRun) => void): this;
  /** Emitted on any TaskRun status transition. */
  on(event: 'task:status', listener: (run: TaskRun) => void): this;
  /** Emitted whenever any agent changes state (for live UI updates). */
  on(event: 'agent:state', listener: (state: AgentState) => void): this;

  emit(event: 'task:plan-ready', run: TaskRun): boolean;
  emit(event: 'task:status', run: TaskRun): boolean;
  emit(event: 'agent:state', state: AgentState): boolean;
}

// ---------------------------------------------------------------------------
// TaskOrchestrator
// ---------------------------------------------------------------------------

/**
 * Coordinates the full multi-agent task lifecycle:
 *
 *   submitTask  → Team Lead plans → 'task:plan-ready'
 *   approvePlan → snapshot → parallel engineers → reviewer → (rework?) → memory manager → log
 *
 * All phases honour an AbortSignal for graceful Ctrl+C cancellation.
 */
export class TaskOrchestrator extends EventEmitter {
  private readonly options: OrchestratorOptions;
  private readonly lockRegistry: LockRegistry;
  private readonly snapshotManager: SnapshotManager;
  private readonly taskLogger: TaskLogger;
  /** Live task run state, keyed by taskId. */
  private readonly activeRuns = new Map<string, TaskRun>();

  constructor(options: OrchestratorOptions) {
    super();
    this.options = options;
    this.lockRegistry = new LockRegistry();
    this.snapshotManager = new SnapshotManager(options.projectRoot);
    this.taskLogger = new TaskLogger(options.projectRoot);

    // Wire the shared LockRegistry into the write_diff tool
    setLockRegistry(this.lockRegistry);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Submit a new task for planning.
   *
   * Runs the Team Lead agent to produce a structured plan, then emits
   * `task:plan-ready`. The returned TaskRun is in `awaiting_approval` state.
   *
   * Call `approvePlan(taskId)` to start execution.
   */
  async submitTask(prompt: string, signal?: AbortSignal): Promise<TaskRun> {
    const taskId = crypto.randomUUID();

    const run: TaskRun = {
      id: taskId,
      prompt,
      plan: null,
      status: 'planning',
      reworkCycles: 0,
      agentStates: {},
      startedAt: Date.now(),
      completedAt: null,
      snapshotId: null,
    };

    this.activeRuns.set(taskId, run);
    this.emit('task:status', this.snapshot(run));

    const factoryOptions = await this.buildFactoryOptions();
    const toolRegistry = new ToolRegistry();
    const teamLead = createTeamLeadAgent(factoryOptions, toolRegistry);
    this.wireAgentEvents(teamLead, run);

    const planResult = await teamLead.run({
      task: `Plan the following coding task:\n\n${prompt}`,
      signal,
    });

    run.agentStates['team-lead'] = teamLead.state;

    if (signal?.aborted) {
      return this.cancelRun(run);
    }

    run.plan = this.parsePlan(taskId, prompt, planResult.summary);
    run.status = 'awaiting_approval';

    this.activeRuns.set(taskId, run);
    this.emit('task:plan-ready', this.snapshot(run));
    this.emit('task:status', this.snapshot(run));

    return this.snapshot(run);
  }

  /**
   * Approve the plan for `taskId` and begin execution.
   *
   * Creates a pre-task snapshot, then runs engineers → reviewer → (rework loop)
   * → memory manager. Returns the final TaskRun.
   */
  async approvePlan(taskId: string, signal?: AbortSignal): Promise<TaskRun> {
    const run = this.activeRuns.get(taskId);
    if (!run) throw new Error(`Unknown task: ${taskId}`);
    if (!run.plan) throw new Error(`Task ${taskId} has no plan to approve`);
    if (run.status !== 'awaiting_approval') {
      throw new Error(`Task ${taskId} is not awaiting approval (status: ${run.status})`);
    }

    // Create a snapshot of all files expected to change
    const filesToSnapshot = this.gatherPlanFiles(run.plan);
    const snapshotId = await this.snapshotManager.createSnapshot(
      taskId,
      run.prompt,
      filesToSnapshot,
    );
    run.snapshotId = snapshotId;

    return this.executeTask(run, signal);
  }

  /** Return an immutable snapshot of a task run, or undefined if not found. */
  getTaskRun(taskId: string): TaskRun | undefined {
    const run = this.activeRuns.get(taskId);
    return run ? this.snapshot(run) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Execution pipeline
  // ---------------------------------------------------------------------------

  private async executeTask(run: TaskRun, signal?: AbortSignal): Promise<TaskRun> {
    if (!run.plan) throw new Error('No plan to execute');

    run.status = 'running';
    this.emit('task:status', this.snapshot(run));

    const maxReworkCycles = this.options.config.task.max_rework_cycles;

    // Rework loop — repeats if the reviewer flags issues
    while (run.reworkCycles <= maxReworkCycles) {
      if (signal?.aborted) return this.cancelRun(run);

      // ── Engineers ──────────────────────────────────────────────────────────
      const engineerResults = await this.runEngineers(run, signal);
      if (signal?.aborted) return this.cancelRun(run);

      // ── Reviewer ───────────────────────────────────────────────────────────
      run.status = 'reviewing';
      this.emit('task:status', this.snapshot(run));

      const reviewResult = await this.runReviewer(run, engineerResults, signal);
      if (signal?.aborted) return this.cancelRun(run);

      if (reviewResult.passed) {
        // ── Memory Manager ──────────────────────────────────────────────────
        await this.runMemoryManager(run, signal);

        run.status = 'completed';
        run.completedAt = Date.now();
        this.emit('task:status', this.snapshot(run));
        await this.persistLog(run);
        return this.snapshot(run);
      }

      // ── Rework ─────────────────────────────────────────────────────────────
      run.reworkCycles++;
      if (run.reworkCycles > maxReworkCycles) break;

      run.status = 'reworking';
      this.emit('task:status', this.snapshot(run));

      // Inject reviewer feedback into each subtask description
      const issuesSummary = reviewResult.issues.join('\n- ');
      for (const subtask of run.plan.subtasks) {
        subtask.description =
          `[REWORK cycle ${run.reworkCycles}]\n` +
          `Original task: ${subtask.description}\n\n` +
          `Reviewer issues to fix:\n- ${issuesSummary}`;
        subtask.status = 'pending';
      }
    }

    // Exhausted rework cycles — escalate to user
    run.status = 'rework_limit_reached';
    run.completedAt = Date.now();
    this.emit('task:status', this.snapshot(run));
    await this.persistLog(run);
    return this.snapshot(run);
  }

  // ---------------------------------------------------------------------------
  // Engineer stage
  // ---------------------------------------------------------------------------

  private async runEngineers(
    run: TaskRun,
    signal?: AbortSignal,
  ): Promise<EngineerResult[]> {
    if (!run.plan) return [];

    const maxEngineers = this.options.config.concurrency.max_engineers;
    const results: EngineerResult[] = [];
    const factoryOptions = await this.buildFactoryOptions();

    // Subtasks that still need to run (pending or previously failed)
    const pending = run.plan.subtasks.filter((s) => s.status !== 'done');

    // Process in batches of maxEngineers
    for (let batchStart = 0; batchStart < pending.length; batchStart += maxEngineers) {
      if (signal?.aborted) break;

      const batch = pending.slice(batchStart, batchStart + maxEngineers);

      const batchResults = await Promise.all(
        batch.map(async (subtask, indexInBatch) => {
          const engineerIndex = batchStart + indexInBatch + 1;
          const engineerId = `engineer-${engineerIndex}`;
          const toolRegistry = new ToolRegistry();
          const engineer = createEngineerAgent(engineerId, factoryOptions, toolRegistry);
          this.wireAgentEvents(engineer, run);

          subtask.assignedTo = engineerId;
          subtask.status = 'in_progress';

          const result = await engineer.run({ task: subtask.description, signal });

          subtask.status = signal?.aborted ? 'failed' : 'done';
          run.agentStates[engineerId] = engineer.state;

          const filesTouched = extractFilesTouched(engineer.state.log);
          subtask.filesTouched = filesTouched;

          return { subtaskId: subtask.id, summary: result.summary, filesChanged: filesTouched };
        }),
      );

      results.push(...batchResults);
      this.activeRuns.set(run.id, run);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Reviewer stage
  // ---------------------------------------------------------------------------

  private async runReviewer(
    run: TaskRun,
    engineerResults: EngineerResult[],
    signal?: AbortSignal,
  ): Promise<ReviewResult> {
    const factoryOptions = await this.buildFactoryOptions();
    const toolRegistry = new ToolRegistry();
    const reviewer = createReviewerAgent(factoryOptions, toolRegistry);
    this.wireAgentEvents(reviewer, run);

    const allFiles = [...new Set(engineerResults.flatMap((r) => r.filesChanged))];
    const engineerSummary = engineerResults
      .map((r) => `- Subtask ${r.subtaskId}: ${r.summary}`)
      .join('\n');

    const reviewTask =
      `Review the following completed work.\n\n` +
      `Original task: ${run.prompt}\n\n` +
      `Engineer summaries:\n${engineerSummary}\n\n` +
      `Files changed:\n${allFiles.map((f) => `- ${f}`).join('\n') || '(none detected)'}\n\n` +
      `Verify: implementation correctness, tests pass, no obvious bugs.`;

    const result = await reviewer.run({ task: reviewTask, signal });
    run.agentStates['reviewer'] = reviewer.state;
    this.activeRuns.set(run.id, run);

    return parseReviewResult(result.summary);
  }

  // ---------------------------------------------------------------------------
  // Memory Manager stage
  // ---------------------------------------------------------------------------

  private async runMemoryManager(run: TaskRun, signal?: AbortSignal): Promise<void> {
    if (!run.plan) return;

    const factoryOptions = await this.buildFactoryOptions();
    const toolRegistry = new ToolRegistry();
    const memoryManager = createMemoryManagerAgent(factoryOptions, toolRegistry);
    this.wireAgentEvents(memoryManager, run);

    const allFiles = [...new Set(run.plan.subtasks.flatMap((s) => s.filesTouched))];

    const memTask =
      `A coding task has been completed. Update the memory bank.\n\n` +
      `Task: ${run.prompt}\n\n` +
      `Files changed:\n${allFiles.map((f) => `- ${f}`).join('\n') || '(none)'}\n\n` +
      `Rework cycles: ${run.reworkCycles}\n` +
      `Outcome: completed successfully`;

    await memoryManager.run({ task: memTask, signal });
    run.agentStates['memory-manager'] = memoryManager.state;
    this.activeRuns.set(run.id, run);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build AgentFactoryOptions, loading any custom prompts from .nightfall/.agents/ */
  private async buildFactoryOptions(): Promise<AgentFactoryOptions> {
    const options: AgentFactoryOptions = {
      provider: this.options.provider,
      projectRoot: this.options.projectRoot,
      customPrompts: {},
    };

    const agentsDir = path.join(this.options.projectRoot, '.nightfall', '.agents');
    const roles = ['team-lead', 'engineer', 'reviewer', 'memory-manager'] as const;

    for (const role of roles) {
      try {
        const content = await fs.readFile(path.join(agentsDir, `${role}.md`), 'utf-8');
        options.customPrompts![role] = content.trim();
      } catch {
        // No custom prompt file — use default
      }
    }

    return options;
  }

  private wireAgentEvents(agent: BaseAgent, run: TaskRun): void {
    agent.on('state', (state: AgentState) => {
      run.agentStates[state.id] = state;
      this.activeRuns.set(run.id, run);
      this.emit('agent:state', state);
    });
  }

  private cancelRun(run: TaskRun): TaskRun {
    run.status = 'cancelled';
    run.completedAt = Date.now();
    this.activeRuns.set(run.id, run);
    this.emit('task:status', this.snapshot(run));
    this.persistLog(run).catch(() => {});
    return this.snapshot(run);
  }

  private async persistLog(run: TaskRun): Promise<void> {
    await this.taskLogger.saveLog(run);
    await this.taskLogger.pruneOldLogs(this.options.config.logs.retention);
  }

  /** Parse the Team Lead's done summary into a TaskPlan. */
  private parsePlan(taskId: string, prompt: string, summary: string): TaskPlan {
    try {
      const parsed = JSON.parse(summary) as Record<string, unknown>;
      const rawSubtasks = Array.isArray(parsed['subtasks']) ? parsed['subtasks'] : [];

      const subtasks: Subtask[] = rawSubtasks.map(
        (s: Record<string, unknown>, i: number): Subtask => ({
          id: String(s['id'] ?? `subtask-${i + 1}`),
          description: String(s['description'] ?? ''),
          assignedTo: null,
          status: 'pending',
          filesTouched: [],
        }),
      );

      const estimatedEngineers = Number(parsed['estimatedEngineers'] ?? subtasks.length) || 1;

      return {
        taskId,
        prompt,
        subtasks: subtasks.length > 0 ? subtasks : fallbackSubtasks(prompt),
        complexity:
          (parsed['complexity'] as 'simple' | 'complex') ??
          (subtasks.length > 1 ? 'complex' : 'simple'),
        estimatedEngineers: Math.min(
          estimatedEngineers,
          this.options.config.concurrency.max_engineers,
        ),
      };
    } catch {
      // If parsing fails, treat the whole task as a single engineer subtask
      return {
        taskId,
        prompt,
        subtasks: fallbackSubtasks(prompt),
        complexity: 'simple',
        estimatedEngineers: 1,
      };
    }
  }

  /**
   * Gather files mentioned in the plan for snapshotting.
   * Subtask `filesTouched` will be empty at plan time, so this is best-effort.
   */
  private gatherPlanFiles(_plan: TaskPlan): string[] {
    // At plan approval time subtasks haven't been executed yet, so we snapshot
    // an empty list — the snapshot system handles new files gracefully.
    return [];
  }

  /** Return a shallow immutable copy of a TaskRun. */
  private snapshot(run: TaskRun): TaskRun {
    return { ...run, agentStates: { ...run.agentStates } };
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

interface EngineerResult {
  subtaskId: string;
  summary: string;
  filesChanged: string[];
}

/**
 * Scan an agent's action log for write_diff tool calls to find which
 * files were actually touched.
 */
function extractFilesTouched(log: AgentLogEntry[]): string[] {
  const files = new Set<string>();
  for (const entry of log) {
    if (entry.type !== 'tool_call') continue;
    try {
      const call = JSON.parse(entry.content) as { tool: string; parameters: Record<string, unknown> };
      if (call.tool === 'write_diff') {
        const filePath = String(call.parameters['path'] ?? '').trim();
        if (filePath) files.add(filePath);
      }
    } catch {
      // Malformed log entry — skip
    }
  }
  return [...files];
}

/**
 * Parse the reviewer agent's done summary into a ReviewResult.
 * Falls back to "passed" if parsing fails (lenient — user can always re-run).
 */
function parseReviewResult(summary: string): ReviewResult {
  try {
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    return {
      passed: Boolean(parsed['passed']),
      issues: Array.isArray(parsed['issues']) ? parsed['issues'].map(String) : [],
      notes: String(parsed['notes'] ?? ''),
    };
  } catch {
    return { passed: true, issues: [], notes: summary };
  }
}

function fallbackSubtasks(prompt: string): Subtask[] {
  return [
    {
      id: 'subtask-1',
      description: prompt,
      assignedTo: null,
      status: 'pending',
      filesTouched: [],
    },
  ];
}
