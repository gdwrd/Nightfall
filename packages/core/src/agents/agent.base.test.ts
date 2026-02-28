import { describe, it, expect, beforeEach } from 'vitest';
import { BaseAgent } from './agent.base.js';
import { ToolRegistry } from '../tools/tool.registry.js';
import type { AgentConfig } from './agent.base.js';
import type { ProviderAdapter, ChatMessage } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock ProviderAdapter that yields the given responses in order. */
function makeProvider(responses: string[]): ProviderAdapter {
  let idx = 0;
  return {
    async *complete(_messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
      if (signal?.aborted) return;
      const response = responses[idx++] ?? '<done>{"summary":"done"}</done>';
      // Yield the whole response in one chunk (simulates streamed output)
      yield response;
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'engineer-1',
    role: 'engineer',
    projectRoot: '/tmp/test-project',
    systemPrompt: 'You are an engineer.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseAgent', () => {
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
  });

  // --- Done signal ---

  it('returns the summary from a <done> signal', async () => {
    const provider = makeProvider(['<done>{"summary":"Task complete"}</done>']);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const result = await agent.run({ task: 'Do something' });
    expect(result.summary).toBe('Task complete');
  });

  it('treats a bare response (no done, no tool call) as the final answer', async () => {
    const provider = makeProvider(['I have finished the work.']);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const result = await agent.run({ task: 'Do something' });
    expect(result.summary).toBe('I have finished the work.');
  });

  // --- Log entries ---

  it('adds a thought log entry for every LLM response', async () => {
    const provider = makeProvider(['<done>{"summary":"done"}</done>']);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const result = await agent.run({ task: 'task' });
    const thoughts = result.log.filter((e) => e.type === 'thought');
    expect(thoughts.length).toBe(1);
  });

  it('adds tool_call and tool_result log entries when a tool is invoked', async () => {
    // team-lead can call read_memory; point it at a non-existent path (tool will fail gracefully)
    const provider = makeProvider([
      '<tool_call>{"tool":"read_memory","parameters":{"file":"index.md"}}</tool_call>',
      '<done>{"summary":"Memory checked"}</done>',
    ]);
    const agent = new BaseAgent(
      makeConfig({ id: 'team-lead-1', role: 'team-lead', systemPrompt: 'You are the team lead.' }),
      provider,
      toolRegistry,
    );
    const result = await agent.run({ task: 'Check memory' });
    expect(result.log.some((e) => e.type === 'tool_call')).toBe(true);
    expect(result.log.some((e) => e.type === 'tool_result')).toBe(true);
  });

  // --- State events ---

  it('emits state events with correct status transitions', async () => {
    const provider = makeProvider(['<done>{"summary":"done"}</done>']);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const statuses: string[] = [];
    agent.on('state', (s) => statuses.push(s.status));
    await agent.run({ task: 'task' });
    expect(statuses).toContain('thinking');
    expect(statuses).toContain('done');
  });

  it('exposes a state getter that reflects the current agent state', async () => {
    const provider = makeProvider(['<done>{"summary":"done"}</done>']);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    expect(agent.state.status).toBe('idle');
    await agent.run({ task: 'task' });
    expect(agent.state.status).toBe('done');
  });

  // --- Abort / cancellation ---

  it('returns "Cancelled" immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = makeProvider(['<done>{"summary":"should not reach"}</done>']);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const result = await agent.run({ task: 'task', signal: controller.signal });
    expect(result.summary).toBe('Cancelled');
  });

  it('stops and returns "Cancelled" when signal fires during streaming', async () => {
    const controller = new AbortController();
    const provider: ProviderAdapter = {
      async *complete(_messages, signal) {
        // Abort as soon as the provider is called
        controller.abort();
        if (signal?.aborted) return;
        yield 'should not appear';
      },
      isAvailable: async () => true,
      ensureModelReady: async () => {},
    };
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const result = await agent.run({ task: 'task', signal: controller.signal });
    expect(result.summary).toBe('Cancelled');
  });

  // --- Max iterations ---

  it('stops after maxIterations when the LLM never signals done', async () => {
    // Always return a plain thought with no tool call or done block
    const provider = makeProvider(Array(5).fill('thinking...'));
    const agent = new BaseAgent(makeConfig({ maxIterations: 3 }), provider, toolRegistry);
    const result = await agent.run({ task: 'task' });
    // After 3 iterations with no done block, it returns the last response as the answer
    expect(result.summary).toBe('thinking...');
  });

  // --- Tool permission enforcement ---

  it('records a tool_result error when an engineer tries a disallowed tool', async () => {
    // Engineers cannot call assign_task (that's team-lead only)
    const provider = makeProvider([
      '<tool_call>{"tool":"assign_task","parameters":{"subtaskId":"s1","description":"x","assignedTo":"engineer-1"}}</tool_call>',
      '<done>{"summary":"tried"}</done>',
    ]);
    const agent = new BaseAgent(makeConfig(), provider, toolRegistry);
    const result = await agent.run({ task: 'task' });
    const toolResult = result.log.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    // The ToolRegistry throws ToolNotAllowedError which the agent catches and logs
    const parsed = JSON.parse(toolResult!.content) as { success: boolean };
    expect(parsed.success).toBe(false);
  });
});
