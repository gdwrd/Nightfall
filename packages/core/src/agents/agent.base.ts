import { EventEmitter } from 'node:events';
import type {
  AgentRole,
  AgentState,
  AgentLogEntry,
  ProviderAdapter,
  ChatMessage,
  TokenUsage,
} from '@nightfall/shared';
import type { ToolContext, ToolResult } from '../tools/tool.types.js';
import { ToolRegistry } from '../tools/tool.registry.js';
import { buildSystemPrompt } from './agent.prompts.js';
import { parseToolCall, parseDone } from './agent.parser.js';

export interface AgentConfig {
  /** Unique agent identifier, e.g. "engineer-1". */
  id: string;
  /** Role that controls which tools this agent may use. */
  role: AgentRole;
  /** Absolute path to the project root — passed as ToolContext.projectRoot. */
  projectRoot: string;
  /** Role-specific base system prompt (tool instructions are appended automatically). */
  systemPrompt: string;
  /** Maximum number of LLM round-trips before giving up. Defaults to 20. */
  maxIterations?: number;
  /**
   * Approximate token budget for the conversation history.
   * When the estimated token count exceeds this threshold the oldest
   * tool-call/result pairs are dropped (preserving system + original task).
   * Tokens are estimated at ~4 chars per token.
   */
  maxContextTokens?: number;
}

export interface AgentRunOptions {
  /** Natural-language task description sent as the first user message. */
  task: string;
  /** Honour an AbortSignal for task interruption (Ctrl+C). */
  signal?: AbortSignal;
}

export interface AgentRunResult {
  /** Final summary produced by the agent (from <done> or last response). */
  summary: string;
  /** Full action log for this run. */
  log: AgentLogEntry[];
  /**
   * True when the agent exhausted its maxIterations budget without emitting a
   * done signal. The orchestrator should treat this as a failed/blocked result
   * rather than a successful completion.
   */
  interrupted?: boolean;
  /** Aggregated token usage across all LLM calls in this run. */
  tokenUsage?: TokenUsage;
}

// ---------------------------------------------------------------------------
// Event declarations (declaration merging is the standard Node.js pattern
// for typed EventEmitters — safe to use here)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface BaseAgent {
  on(event: 'state', listener: (state: AgentState) => void): this;
  emit(event: 'state', state: AgentState): boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate token count: ~4 characters per token. */
function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
}

/**
 * Compact `messages` in-place so the estimated token count fits within `budget`.
 *
 * Strategy: drop the oldest tool-call/result pairs (indices 2 & 3 after
 * system + original-task) until the estimate is within budget or no more
 * pairs remain to drop.
 */
function compactMessages(messages: ChatMessage[], budget: number): void {
  while (estimateTokens(messages) > budget && messages.length > 4) {
    // messages[0] = system, messages[1] = original task — always preserved.
    // messages[2] and messages[3] are the oldest assistant/user tool exchange.
    messages.splice(2, 2);
  }
}

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

/**
 * Core agent loop: call the LLM, parse tool calls, execute them via the
 * ToolRegistry, feed results back, repeat until the agent signals <done> or
 * runs out of iterations.
 *
 * All 4 agent roles (team-lead, engineer, reviewer, memory-manager) are
 * instances of this class with different configs and system prompts.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class BaseAgent extends EventEmitter {
  protected readonly config: AgentConfig;
  protected readonly provider: ProviderAdapter;
  protected readonly toolRegistry: ToolRegistry;

  private _state: AgentState;

  constructor(config: AgentConfig, provider: ProviderAdapter, toolRegistry: ToolRegistry) {
    super();
    this.config = config;
    this.provider = provider;
    this.toolRegistry = toolRegistry;

    this._state = {
      id: config.id,
      role: config.role,
      status: 'idle',
      currentAction: null,
      log: [],
    };
  }

  /** Snapshot of the current agent state with log trimmed to last 50 entries (for broadcast). */
  get state(): AgentState {
    const MAX_BROADCAST_LOG = 50;
    return { ...this._state, log: this._state.log.slice(-MAX_BROADCAST_LOG) };
  }

  /** Full untruncated log — used for internal processing (e.g. AgentRunResult, extractFilesTouched). */
  private get fullLog(): AgentLogEntry[] {
    return this._state.log;
  }

  /**
   * Run the agent on the given task.
   * Resolves when the agent is done (or cancelled/errored).
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { task, signal } = options;
    const maxIterations = this.config.maxIterations ?? 20;
    const maxContextTokens = this.config.maxContextTokens;

    this.setStatus('thinking', 'Processing task...');

    // Build the system prompt (role prompt + tool descriptions + protocol)
    const toolDefs = this.toolRegistry.getToolsForRole(this.config.role);
    const systemPrompt = buildSystemPrompt(this.config.systemPrompt, toolDefs);

    // Conversation history (grows as tool calls are exchanged)
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    // Accumulated token usage across all LLM calls in this run
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // --- Abort check ---
      if (signal?.aborted) {
        this.setStatus('done', null, 'Cancelled');
        return { summary: 'Cancelled', log: this.fullLog };
      }

      // --- Context window management ---
      if (maxContextTokens) {
        compactMessages(messages, maxContextTokens);
        if (estimateTokens(messages) > maxContextTokens) {
          process.stderr.write(
            `[nightfall] agent ${this.config.id}: context overflow — ` +
            `~${estimateTokens(messages)} tokens exceeds budget ${maxContextTokens}; ` +
            `no messages left to compact (${messages.length} total).\n`,
          );
        }
      }

      // --- LLM call ---
      this.setStatus('thinking', '');
      let response = '';
      let lastEmit = Date.now();
      for await (const chunk of this.provider.complete(messages, signal)) {
        response += chunk;
        // Throttle: emit a live preview of the streaming response every 200 ms
        const now = Date.now();
        if (now - lastEmit >= 200) {
          this.setStatus('thinking', response.trim());
          lastEmit = now;
        }
        if (signal?.aborted) break;
      }

      // Accumulate token usage from this iteration
      const usage = this.provider.getLastUsage?.();
      if (usage) {
        totalPromptTokens += usage.promptTokens;
        totalCompletionTokens += usage.completionTokens;
      }

      if (signal?.aborted) {
        this.setStatus('done', null, 'Cancelled');
        return { summary: 'Cancelled', log: this.fullLog };
      }

      // Final emit with the complete response text
      if (response.trim()) {
        this.setStatus('thinking', response.trim());
      }

      this.addLog({ type: 'thought', content: response.trim() });

      // --- Tool call? ---
      const toolCall = parseToolCall(response);
      if (toolCall) {
        this.setStatus('acting', `Calling tool: ${toolCall.tool}`);
        this.addLog({ type: 'tool_call', content: JSON.stringify(toolCall) });

        const ctx: ToolContext = {
          agentId: this.config.id,
          role: this.config.role,
          projectRoot: this.config.projectRoot,
        };

        let result: ToolResult;
        try {
          result = await this.toolRegistry.execute(toolCall, ctx);
        } catch (err) {
          result = {
            tool: toolCall.tool,
            success: false,
            output: '',
            error: err instanceof Error ? err.message : String(err),
          };
        }
        this.addLog({ type: 'tool_result', content: JSON.stringify(result) });

        // Extend conversation with this turn's exchange
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'user',
          content: result.success
            ? `Tool result (${toolCall.tool}):\n${result.output}`
            : `Tool error (${toolCall.tool}): ${result.error ?? 'Unknown error'}`,
        });
        continue;
      }

      // --- Done signal? ---
      const done = parseDone(response);
      if (done) {
        this.setStatus('done', null, done.summary);
        return {
          summary: done.summary,
          log: this.fullLog,
          tokenUsage: this.buildTokenUsage(totalPromptTokens, totalCompletionTokens),
        };
      }

      // --- No special signal — treat as final answer ---
      this.setStatus('done', null, response.trim());
      return {
        summary: response.trim(),
        log: this.fullLog,
        tokenUsage: this.buildTokenUsage(totalPromptTokens, totalCompletionTokens),
      };
    }

    // Exhausted max iterations — signal interrupted so the orchestrator can
    // treat this as a blocked result rather than a successful completion.
    const iterationMsg = `Agent reached maximum iteration limit (${maxIterations})`;
    this.setStatus('done', null, iterationMsg);
    return {
      summary: iterationMsg,
      log: this.fullLog,
      interrupted: true,
      tokenUsage: this.buildTokenUsage(totalPromptTokens, totalCompletionTokens),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildTokenUsage(promptTokens: number, completionTokens: number): TokenUsage | undefined {
    if (promptTokens === 0 && completionTokens === 0) return undefined;
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
  }

  private setStatus(
    status: AgentState['status'],
    currentAction: string | null,
    summary?: string,
  ): void {
    this._state = { ...this._state, status, currentAction };
    if (summary !== undefined) {
      this._state = { ...this._state, summary };
    }
    this.emit('state', this.state);
  }

  private addLog(entry: Omit<AgentLogEntry, 'timestamp'>): void {
    const logEntry: AgentLogEntry = { timestamp: Date.now(), ...entry };
    this._state = { ...this._state, log: [...this._state.log, logEntry] };
    this.emit('state', this.state);
  }
}
