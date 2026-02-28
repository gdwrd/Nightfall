import { EventEmitter } from 'node:events';
import type { AgentRole, AgentState, AgentLogEntry, ProviderAdapter, ChatMessage } from '@nightfall/shared';
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
}

// ---------------------------------------------------------------------------
// Event declarations
// ---------------------------------------------------------------------------

export declare interface BaseAgent {
  on(event: 'state', listener: (state: AgentState) => void): this;
  emit(event: 'state', state: AgentState): boolean;
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

  /** Snapshot of the current agent state (immutable copy). */
  get state(): AgentState {
    return { ...this._state, log: [...this._state.log] };
  }

  /**
   * Run the agent on the given task.
   * Resolves when the agent is done (or cancelled/errored).
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { task, signal } = options;
    const maxIterations = this.config.maxIterations ?? 20;

    this.setStatus('thinking', 'Processing task...');

    // Build the system prompt (role prompt + tool descriptions + protocol)
    const toolDefs = this.toolRegistry.getToolsForRole(this.config.role);
    const systemPrompt = buildSystemPrompt(this.config.systemPrompt, toolDefs);

    // Conversation history (grows as tool calls are exchanged)
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // --- Abort check ---
      if (signal?.aborted) {
        this.setStatus('done', null);
        return { summary: 'Cancelled', log: this.state.log };
      }

      // --- LLM call ---
      this.setStatus('thinking', 'Thinking...');
      let response = '';
      for await (const chunk of this.provider.complete(messages, signal)) {
        response += chunk;
        if (signal?.aborted) break;
      }

      if (signal?.aborted) {
        this.setStatus('done', null);
        return { summary: 'Cancelled', log: this.state.log };
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
        this.setStatus('done', null);
        return { summary: done.summary, log: this.state.log };
      }

      // --- No special signal — treat as final answer ---
      this.setStatus('done', null);
      return { summary: response.trim(), log: this.state.log };
    }

    // Exhausted max iterations — signal interrupted so the orchestrator can
    // treat this as a blocked result rather than a successful completion.
    this.setStatus('done', null);
    return {
      summary: `Agent reached maximum iteration limit (${maxIterations})`,
      log: this.state.log,
      interrupted: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private setStatus(status: AgentState['status'], currentAction: string | null): void {
    this._state = { ...this._state, status, currentAction };
    this.emit('state', this.state);
  }

  private addLog(entry: Omit<AgentLogEntry, 'timestamp'>): void {
    const logEntry: AgentLogEntry = { timestamp: Date.now(), ...entry };
    this._state = { ...this._state, log: [...this._state.log, logEntry] };
    this.emit('state', this.state);
  }
}
