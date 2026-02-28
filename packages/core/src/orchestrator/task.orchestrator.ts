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
  FileLock,
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
// Event type augmentation (declaration merging is the standard Node.js
// pattern for typed EventEmitters — safe to use here)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface TaskOrchestrator {
  /** Emitted when the Team Lead has produced a plan ready for user approval. */
  on(event: 'task:plan-ready', listener: (run: TaskRun) => void): this;
  /** Emitted on any TaskRun status transition. */
  on(event: 'task:status', listener: (run: TaskRun) => void): this;
  /** Emitted whenever any agent changes state (for live UI updates). */
  on(event: 'agent:state', listener: (state: AgentState) => void): this;
  /** Emitted whenever the file lock set changes. */
  on(event: 'lock:update', listener: (locks: FileLock[]) => void): this;

  emit(event: 'task:plan-ready', run: TaskRun): boolean;
  emit(event: 'task:status', run: TaskRun): boolean;
  emit(event: 'agent:state', state: AgentState): boolean;
  emit(event: 'lock:update', locks: FileLock[]): boolean;
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
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
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

    // Forward lock events so the UI can track locked files
    const emitLocks = () => this.emit('lock:update', this.lockRegistry.getLocks());
    this.lockRegistry.on('lock_acquired', emitLocks);
    this.lockRegistry.on('lock_released', emitLocks);
    this.lockRegistry.on('lock_deadlock', emitLocks);
  }

  /** Return the current set of held file locks. */
  getLocks(): FileLock[] {
    return this.lockRegistry.getLocks();
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
  async approvePlan(taskId: string, signal?: AbortSignal, editedPlan?: TaskPlan): Promise<TaskRun> {
    const run = this.activeRuns.get(taskId);
    if (!run) throw new Error(`Unknown task: ${taskId}`);
    if (!run.plan) throw new Error(`Task ${taskId} has no plan to approve`);
    if (run.status !== 'awaiting_approval') {
      throw new Error(`Task ${taskId} is not awaiting approval (status: ${run.status})`);
    }

    // Apply user-edited plan if provided
    if (editedPlan) {
      run.plan = editedPlan;
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
        await this.runMemoryManager(run, engineerResults, signal);

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

      // Inject structured rework context into each subtask. Each engineer gets
      // its own previous attempt summary alongside the reviewer's issues so it
      // knows exactly what went wrong on the prior attempt.
      const issueLines = reviewResult.issues.map((i) => `- ${i}`).join('\n');
      for (const subtask of run.plan.subtasks) {
        const previousAttempt =
          engineerResults.find((r) => r.subtaskId === subtask.id)?.summary ??
          '(no summary from previous attempt)';
        subtask.description =
          `[REWORK — cycle ${run.reworkCycles}]\n\n` +
          `Original task:\n${subtask.description}\n\n` +
          `Your previous attempt result:\n${previousAttempt}\n\n` +
          `Reviewer found these issues — fix ALL of them:\n${issueLines}`;
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

  private async runEngineers(run: TaskRun, signal?: AbortSignal): Promise<EngineerResult[]> {
    if (!run.plan) return [];

    const maxEngineers = this.options.config.concurrency.max_engineers;
    const results: EngineerResult[] = [];
    const factoryOptions = await this.buildFactoryOptions();
    let engineerCounter = 0;

    // Process subtasks in dependency-aware waves. Each iteration finds all
    // subtasks whose dependencies are satisfied and runs them concurrently
    // (up to maxEngineers at a time), then repeats until none remain.
    let madeProgress = true;
    while (madeProgress) {
      if (signal?.aborted) break;

      // Ready = pending and every declared dependency has completed successfully.
      const ready = run.plan.subtasks.filter(
        (s) =>
          s.status === 'pending' &&
          (s.dependsOn ?? []).every(
            (depId) => run.plan!.subtasks.find((d) => d.id === depId)?.status === 'done',
          ),
      );

      if (ready.length === 0) {
        madeProgress = false;
        break;
      }

      // Process the ready wave in batches of maxEngineers.
      for (let batchStart = 0; batchStart < ready.length; batchStart += maxEngineers) {
        if (signal?.aborted) break;

        const batch = ready.slice(batchStart, batchStart + maxEngineers);

        const batchResults = await Promise.all(
          batch.map(async (subtask) => {
            engineerCounter++;
            const engineerId = `engineer-${engineerCounter}`;
            const toolRegistry = new ToolRegistry();
            const engineer = createEngineerAgent(engineerId, factoryOptions, toolRegistry);
            this.wireAgentEvents(engineer, run);

            subtask.assignedTo = engineerId;
            subtask.status = 'in_progress';

            const result = await engineer.run({ task: subtask.description, signal });

            // An engineer is considered blocked if it hit maxIterations or
            // signalled confidence "blocked" in its typed done signal.
            const blocked = result.interrupted === true || isBlockedEngineer(result.summary);
            subtask.status = signal?.aborted || blocked ? 'failed' : 'done';
            run.agentStates[engineerId] = engineer.state;

            const filesTouched = extractFilesTouched(engineer.state.log);
            subtask.filesTouched = filesTouched;

            return {
              subtaskId: subtask.id,
              summary: result.summary,
              filesChanged: filesTouched,
              interrupted: result.interrupted || blocked,
            };
          }),
        );

        results.push(...batchResults);
        this.activeRuns.set(run.id, run);
      }
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

    // Format engineer done signals — pass structured JSON through when available
    // so the reviewer can inspect confidence levels and concerns directly.
    const engineerDetails = engineerResults
      .map((r) => {
        const prefix = `Subtask ${r.subtaskId}`;
        if (r.interrupted) {
          return `${prefix}: INTERRUPTED — engineer did not complete this subtask`;
        }
        try {
          const typed = JSON.parse(r.summary) as Record<string, unknown>;
          return `${prefix}:\n${JSON.stringify(typed, null, 2)}`;
        } catch {
          return `${prefix}: ${r.summary}`;
        }
      })
      .join('\n\n');

    const reviewTask =
      `Review the following completed engineering work.\n\n` +
      `Original task: ${run.prompt}\n\n` +
      `Engineer done signals (structured):\n${engineerDetails}\n\n` +
      `Files changed:\n${allFiles.map((f) => `- ${f}`).join('\n') || '(none detected)'}\n\n` +
      `IMPORTANT: Do not trust engineer-reported results. Re-run all tests and linting ` +
      `independently. Verify every changed file. Check against the original task requirements.`;

    const result = await reviewer.run({ task: reviewTask, signal });
    run.agentStates['reviewer'] = reviewer.state;
    this.activeRuns.set(run.id, run);

    return parseReviewResult(result.summary);
  }

  // ---------------------------------------------------------------------------
  // Memory Manager stage
  // ---------------------------------------------------------------------------

  private async runMemoryManager(
    run: TaskRun,
    engineerResults: EngineerResult[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (!run.plan) return;

    const factoryOptions = await this.buildFactoryOptions();
    const toolRegistry = new ToolRegistry();
    const memoryManager = createMemoryManagerAgent(factoryOptions, toolRegistry);
    this.wireAgentEvents(memoryManager, run);

    const allFiles = [...new Set(run.plan.subtasks.flatMap((s) => s.filesTouched))];

    const engineerSummary = engineerResults
      .map((r) => `- Subtask ${r.subtaskId}: ${r.summary}`)
      .join('\n');

    const memTask =
      `A coding task has been completed and verified. Update the memory bank.\n\n` +
      `Task: ${run.prompt}\n\n` +
      `Files changed:\n${allFiles.map((f) => `- ${f}`).join('\n') || '(none)'}\n\n` +
      `Engineer results:\n${engineerSummary}\n\n` +
      `Reviewer verdict: PASSED\n` +
      `Rework cycles used: ${run.reworkCycles}\n\n` +
      `Only promote patterns that were part of the final passing implementation.`;

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
          description: buildSubtaskDescription(s),
          assignedTo: null,
          status: 'pending',
          filesTouched: [],
          dependsOn: Array.isArray(s['dependsOn']) ? s['dependsOn'].map(String) : [],
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
  interrupted?: boolean;
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
      const call = JSON.parse(entry.content) as {
        tool: string;
        parameters: Record<string, unknown>;
      };
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
 * Handles both the legacy flat-string issues format and the new evidence-backed
 * format where each issue is {description, evidence}. Falls back to "passed"
 * if parsing fails (lenient — user can always re-run).
 */
function parseReviewResult(summary: string): ReviewResult {
  try {
    const parsed = JSON.parse(summary) as Record<string, unknown>;

    const rawIssues = Array.isArray(parsed['issues']) ? parsed['issues'] : [];
    const issues = rawIssues.map((issue: unknown): string => {
      if (typeof issue === 'string') return issue;
      if (typeof issue === 'object' && issue !== null) {
        const i = issue as Record<string, unknown>;
        const desc = String(i['description'] ?? '');
        const evidence = typeof i['evidence'] === 'string' ? ` (evidence: ${i['evidence']})` : '';
        return `${desc}${evidence}`;
      }
      return String(issue);
    });

    return {
      passed: Boolean(parsed['passed']),
      issues,
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
      dependsOn: [],
    },
  ];
}

/**
 * Build a full subtask description from the Team Lead's structured subtask JSON.
 * Appends successCriteria and constraints as explicit sections so the engineer
 * receives them as part of the task description rather than as separate fields
 * that could be ignored.
 */
function buildSubtaskDescription(s: Record<string, unknown>): string {
  let desc = String(s['description'] ?? '');

  const criteria = Array.isArray(s['successCriteria']) ? s['successCriteria'].map(String) : [];
  if (criteria.length > 0) {
    desc +=
      `\n\nSuccess criteria (your done signal must satisfy all of these):\n` +
      criteria.map((c) => `- ${c}`).join('\n');
  }

  const constraints = Array.isArray(s['constraints']) ? s['constraints'].map(String) : [];
  if (constraints.length > 0) {
    desc +=
      `\n\nConstraints (hard requirements — do not violate):\n` +
      constraints.map((c) => `- ${c}`).join('\n');
  }

  return desc;
}

/**
 * Check whether an engineer's done signal summary indicates a blocked/stuck state.
 * Engineers signal this by setting confidence to "blocked" in their typed done JSON.
 */
function isBlockedEngineer(summary: string): boolean {
  try {
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    return parsed['confidence'] === 'blocked';
  } catch {
    return false;
  }
}
