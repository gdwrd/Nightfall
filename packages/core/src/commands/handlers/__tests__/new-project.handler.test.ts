import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProviderAdapter, ChatMessage } from '@nightfall/shared';
import { newProjectHandler, _testSessionManager } from '../new-project.handler.js';
import type { CommandDispatcherContext } from '../../command.dispatcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

/**
 * Create a mock provider that yields responses sequentially.
 * Each call to complete() returns the next response in the list.
 * Optionally yields responses in multiple chunks to test streaming.
 */
function makeProvider(
  responses: string[] = [],
  opts?: { chunkSize?: number },
): ProviderAdapter {
  let idx = 0;
  return {
    async *complete(_messages: ChatMessage[]): AsyncGenerator<string> {
      const response = responses[idx++] ?? 'Default follow-up question?';
      if (opts?.chunkSize) {
        // Yield in chunks to simulate streaming
        for (let i = 0; i < response.length; i += opts.chunkSize) {
          yield response.slice(i, i + opts.chunkSize);
        }
      } else {
        yield response;
      }
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
}

/**
 * Create a mock provider that captures the messages passed to complete().
 */
function makeCapturingProvider(
  responses: string[] = [],
): { provider: ProviderAdapter; calls: ChatMessage[][] } {
  let idx = 0;
  const calls: ChatMessage[][] = [];
  const provider: ProviderAdapter = {
    async *complete(messages: ChatMessage[]): AsyncGenerator<string> {
      calls.push([...messages]);
      const response = responses[idx++] ?? 'Default question?';
      yield response;
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
  return { provider, calls };
}

function makeCtx(provider?: ProviderAdapter): CommandDispatcherContext {
  return {
    config: {} as CommandDispatcherContext['config'],
    projectRoot: tmpDir,
    orchestrator: {} as CommandDispatcherContext['orchestrator'],
    provider: provider ?? makeProvider(),
  };
}

function parse(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-integration-'));
  const sessions = (_testSessionManager as unknown as { sessions: Map<string, unknown> }).sessions;
  sessions.clear();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Full wizard lifecycle — happy path
// ---------------------------------------------------------------------------

describe('integration: full wizard lifecycle', () => {
  it('completes start → answer → answer → [SPEC_READY] → generate-spec → generate-plan', async () => {
    const provider = makeProvider([
      'What is the target audience?',       // first question after start
      'What platforms should it support?',   // second question after answer
      'Enough detail. [SPEC_READY]',         // third answer triggers completion
      '# Task App Spec\n\nA comprehensive specification for a task management app.',
      '# Task App Plan\n\n## Phase 1\n\nSet up the project structure.',
    ]);
    const ctx = makeCtx(provider);

    // Step 1: Start with idea
    const startResult = parse(await newProjectHandler(ctx, 'start A task management app'));
    expect(startResult.type).toBe('new_project_question');
    expect(startResult.question).toBe('What is the target audience?');
    const sessionId = startResult.sessionId as string;

    // Step 2: First answer
    const answer1 = parse(await newProjectHandler(ctx, `answer ${sessionId} Small business owners`));
    expect(answer1.type).toBe('new_project_question');
    expect(answer1.question).toBe('What platforms should it support?');

    // Step 3: Second answer triggers [SPEC_READY]
    const answer2 = parse(await newProjectHandler(ctx, `answer ${sessionId} Web and mobile`));
    expect(answer2.type).toBe('new_project_gathering_complete');
    expect(answer2.questionCount).toBe(2);

    // Step 4: Generate spec
    const specResult = parse(await newProjectHandler(ctx, `generate-spec ${sessionId}`));
    expect(specResult.type).toBe('new_project_spec_saved');
    expect(specResult.specPath).toBeDefined();

    // Verify spec file exists and has content
    const specContent = await fs.readFile(specResult.specPath as string, 'utf-8');
    expect(specContent).toContain('Task App Spec');
    expect(specContent).toContain('comprehensive specification');

    // Step 5: Generate plan
    const planResult = parse(await newProjectHandler(ctx, `generate-plan ${sessionId}`));
    expect(planResult.type).toBe('new_project_plan_saved');
    expect(planResult.planPath).toBeDefined();

    // Verify plan file exists and has content
    const planContent = await fs.readFile(planResult.planPath as string, 'utf-8');
    expect(planContent).toContain('Task App Plan');
    expect(planContent).toContain('Phase 1');

    // Verify spec and plan are in the same directory
    const specDir = path.dirname(specResult.specPath as string);
    const planDir = path.dirname(planResult.planPath as string);
    expect(specDir).toBe(planDir);

    // Verify session was cleaned up after plan generation
    const afterPlan = parse(await newProjectHandler(ctx, `answer ${sessionId} anything`));
    expect(afterPlan.type).toBe('new_project_error');
    expect(afterPlan.message).toContain('Session expired');
  });

  it('completes flow using /done to end Q&A early', async () => {
    const provider = makeProvider([
      'What is the core problem?',         // consumed by start
      'What about scalability?',            // consumed by answer
      '# Early Spec\n\nSpec from early /done.',  // consumed by generate-spec
    ]);
    const ctx = makeCtx(provider);

    // Start
    const startResult = parse(await newProjectHandler(ctx, 'start A chat app'));
    const sessionId = startResult.sessionId as string;

    // One answer — gets another question back
    const answerResult = parse(await newProjectHandler(ctx, `answer ${sessionId} Real-time messaging for teams`));
    expect(answerResult.type).toBe('new_project_question');

    // Done early (skip remaining questions)
    const doneResult = parse(await newProjectHandler(ctx, `done ${sessionId}`));
    expect(doneResult.type).toBe('new_project_gathering_complete');

    // Generate spec
    const specResult = parse(await newProjectHandler(ctx, `generate-spec ${sessionId}`));
    expect(specResult.type).toBe('new_project_spec_saved');

    const specContent = await fs.readFile(specResult.specPath as string, 'utf-8');
    expect(specContent).toContain('Early Spec');
  });

  it('allows starting a new session after previous one completes', async () => {
    const provider = makeProvider([
      'Question 1?',
      '[SPEC_READY]',
      '# Spec 1',
      '# Plan 1',
      // Second session
      'Question for session 2?',
    ]);
    const ctx = makeCtx(provider);

    // First session: full lifecycle
    const start1 = parse(await newProjectHandler(ctx, 'start First project'));
    const sid1 = start1.sessionId as string;
    await newProjectHandler(ctx, `answer ${sid1} Answer 1`);
    await newProjectHandler(ctx, `generate-spec ${sid1}`);
    await newProjectHandler(ctx, `generate-plan ${sid1}`);

    // Second session should work fine
    const start2 = parse(await newProjectHandler(ctx, 'start Second project'));
    expect(start2.type).toBe('new_project_question');
    expect(start2.sessionId).not.toBe(sid1);
  });
});

// ---------------------------------------------------------------------------
// Cancel flows
// ---------------------------------------------------------------------------

describe('integration: cancel flows', () => {
  it('cancels mid-flow and allows starting over', async () => {
    const provider = makeProvider([
      'What do you want to build?',
      'Another question?',
    ]);
    const ctx = makeCtx(provider);

    // Start and provide one answer
    const startResult = parse(await newProjectHandler(ctx, 'start My project'));
    const sessionId = startResult.sessionId as string;
    await newProjectHandler(ctx, `answer ${sessionId} A web scraper`);

    // Cancel
    const cancelResult = parse(await newProjectHandler(ctx, `cancel ${sessionId}`));
    expect(cancelResult.type).toBe('new_project_done');
    expect(cancelResult.sessionId).toBe(sessionId);

    // Should be able to start a new session
    const newStart = parse(await newProjectHandler(ctx, 'start A different project'));
    expect(newStart.type).toBe('new_project_question');
    expect(newStart.sessionId).not.toBe(sessionId);
  });

  it('cancel after spec generation includes specPath', async () => {
    const provider = makeProvider([
      'Question?',
      '[SPEC_READY]',
      '# The Spec',
    ]);
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start Build a blog'));
    const sid = start.sessionId as string;
    await newProjectHandler(ctx, `answer ${sid} For tech writers`);
    await newProjectHandler(ctx, `generate-spec ${sid}`);

    // Cancel after spec saved (user doesn't want a plan)
    const cancelResult = parse(await newProjectHandler(ctx, `cancel ${sid}`));
    expect(cancelResult.type).toBe('new_project_done');
    expect(cancelResult.specPath).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Streaming (multi-chunk) responses
// ---------------------------------------------------------------------------

describe('integration: streaming provider responses', () => {
  it('collects multi-chunk responses correctly', async () => {
    const fullQuestion = 'What authentication method do you prefer?';
    const fullSpec = '# Multi Chunk Spec\n\nDetailed spec from streaming.';
    const provider = makeProvider(
      [fullQuestion, '[SPEC_READY]', fullSpec],
      { chunkSize: 5 },
    );
    const ctx = makeCtx(provider);

    // Start — question should be fully assembled from chunks
    const start = parse(await newProjectHandler(ctx, 'start A streaming test app'));
    expect(start.type).toBe('new_project_question');
    expect(start.question).toBe(fullQuestion);
    const sid = start.sessionId as string;

    // Answer triggers [SPEC_READY]
    await newProjectHandler(ctx, `answer ${sid} OAuth2`);

    // Generate spec — spec content should be fully assembled
    const specResult = parse(await newProjectHandler(ctx, `generate-spec ${sid}`));
    expect(specResult.type).toBe('new_project_spec_saved');
    const content = await fs.readFile(specResult.specPath as string, 'utf-8');
    expect(content).toBe(fullSpec);
  });
});

// ---------------------------------------------------------------------------
// Conversation history verification
// ---------------------------------------------------------------------------

describe('integration: conversation history', () => {
  it('passes accumulated history to the LLM on each answer', async () => {
    const { provider, calls } = makeCapturingProvider([
      'First question?',
      'Second question?',
      'Third question?',
    ]);
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start Test history'));
    const sid = start.sessionId as string;

    // First LLM call (start) should have: system + user idea
    expect(calls[0].length).toBe(2);
    expect(calls[0][0].role).toBe('system');
    expect(calls[0][1].role).toBe('user');
    expect(calls[0][1].content).toContain('Test history');

    // First answer
    await newProjectHandler(ctx, `answer ${sid} Answer one`);

    // Second LLM call should have: system + idea + assistant Q1 + user A1
    expect(calls[1].length).toBe(4);
    expect(calls[1][0].role).toBe('system');
    expect(calls[1][1].content).toContain('Test history');
    expect(calls[1][2].role).toBe('assistant');
    expect(calls[1][2].content).toBe('First question?');
    expect(calls[1][3].role).toBe('user');
    expect(calls[1][3].content).toBe('Answer one');

    // Second answer
    await newProjectHandler(ctx, `answer ${sid} Answer two`);

    // Third LLM call should have: system + idea + Q1 + A1 + Q2 + A2
    expect(calls[2].length).toBe(6);
    expect(calls[2][4].role).toBe('assistant');
    expect(calls[2][4].content).toBe('Second question?');
    expect(calls[2][5].role).toBe('user');
    expect(calls[2][5].content).toBe('Answer two');
  });
});

// ---------------------------------------------------------------------------
// MAX_QUESTIONS boundary
// ---------------------------------------------------------------------------

describe('integration: MAX_QUESTIONS auto-completion', () => {
  it('auto-triggers gathering_complete after 20 answers', async () => {
    // Create 21 responses: 20 questions + 1 that won't be used
    const responses: string[] = [];
    for (let i = 0; i < 21; i++) {
      responses.push(`Question ${i + 1}?`);
    }
    const provider = makeProvider(responses);
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start A big project'));
    const sid = start.sessionId as string;

    // Submit 19 answers — should get questions back
    for (let i = 0; i < 19; i++) {
      const result = parse(await newProjectHandler(ctx, `answer ${sid} Answer ${i + 1}`));
      expect(result.type).toBe('new_project_question');
    }

    // 20th answer — should trigger auto-completion
    const final = parse(await newProjectHandler(ctx, `answer ${sid} Answer 20`));
    expect(final.type).toBe('new_project_gathering_complete');
    expect(final.questionCount).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// File path conventions
// ---------------------------------------------------------------------------

describe('integration: file paths', () => {
  it('saves spec and plan to spec/ directory with slug-based names', async () => {
    const provider = makeProvider([
      'Q?',
      '[SPEC_READY]',
      'Spec content',
      'Plan content',
    ]);
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start A recipe sharing platform'));
    const sid = start.sessionId as string;
    await newProjectHandler(ctx, `answer ${sid} Home cooks`);
    const specResult = parse(await newProjectHandler(ctx, `generate-spec ${sid}`));
    const planResult = parse(await newProjectHandler(ctx, `generate-plan ${sid}`));

    const specPath = specResult.specPath as string;
    const planPath = planResult.planPath as string;

    // Both in spec/ directory
    expect(specPath).toContain(path.join('spec', 'recipe-sharing-platform.md'));
    expect(planPath).toContain(path.join('spec', 'recipe-sharing-platform-plan.md'));

    // Plan name derived from spec name
    expect(planPath).toBe(specPath.replace('.md', '-plan.md'));
  });

  it('creates the spec/ directory if it does not exist', async () => {
    const provider = makeProvider([
      'Q?',
      '[SPEC_READY]',
      'Content',
    ]);
    const ctx = makeCtx(provider);

    const specDir = path.join(tmpDir, 'spec');
    // Verify spec/ doesn't exist yet
    await expect(fs.access(specDir)).rejects.toThrow();

    const start = parse(await newProjectHandler(ctx, 'start New project'));
    const sid = start.sessionId as string;
    await newProjectHandler(ctx, `answer ${sid} Users`);
    await newProjectHandler(ctx, `generate-spec ${sid}`);

    // Now spec/ should exist
    const stat = await fs.stat(specDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error scenarios
// ---------------------------------------------------------------------------

describe('integration: error scenarios', () => {
  it('prevents starting a second session while one is active', async () => {
    const provider = makeProvider(['Q?']);
    const ctx = makeCtx(provider);

    await newProjectHandler(ctx, 'start First project');
    const second = parse(await newProjectHandler(ctx, 'start Second project'));
    expect(second.type).toBe('new_project_error');
    expect(second.message).toContain('already in progress');
  });

  it('handles LLM failure during answer gracefully', async () => {
    const responses = ['First question?'];
    let callCount = 0;
    const provider: ProviderAdapter = {
      async *complete(_messages: ChatMessage[]): AsyncGenerator<string> {
        callCount++;
        if (callCount === 1) {
          yield responses[0];
          return;
        }
        throw new Error('LLM service unavailable');
      },
      isAvailable: async () => true,
      ensureModelReady: async () => {},
    };
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start My app'));
    const sid = start.sessionId as string;

    const result = parse(await newProjectHandler(ctx, `answer ${sid} My answer`));
    // Session is preserved on LLM failure — returns a question-type response
    // so the CLI stays in gathering mode and the user can retry.
    expect(result.type).toBe('new_project_question');
    expect(result.sessionId).toBe(sid);
    expect(result.question).toContain('LLM error');
    expect(result.question).toContain('LLM service unavailable');
  });

  it('handles LLM failure during spec generation gracefully', async () => {
    let callCount = 0;
    const provider: ProviderAdapter = {
      async *complete(_messages: ChatMessage[]): AsyncGenerator<string> {
        callCount++;
        if (callCount <= 2) {
          if (callCount === 1) yield 'Q?';
          if (callCount === 2) yield '[SPEC_READY]';
          return;
        }
        throw new Error('Timeout generating spec');
      },
      isAvailable: async () => true,
      ensureModelReady: async () => {},
    };
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start My app'));
    const sid = start.sessionId as string;
    await newProjectHandler(ctx, `answer ${sid} Users`);

    const result = parse(await newProjectHandler(ctx, `generate-spec ${sid}`));
    expect(result.type).toBe('new_project_error');
    expect(result.message).toContain('Timeout generating spec');
  });

  it('prevents generate-plan when spec has not been generated', async () => {
    const provider = makeProvider(['Q?', '[SPEC_READY]']);
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start My app'));
    const sid = start.sessionId as string;
    await newProjectHandler(ctx, `answer ${sid} Users`);

    // Try to generate plan without generating spec first
    const result = parse(await newProjectHandler(ctx, `generate-plan ${sid}`));
    expect(result.type).toBe('new_project_error');
    expect(result.message).toContain('No spec');
  });

  it('returns error for operations on expired sessions', async () => {
    const expiredId = 'expired-session-id';

    const answerResult = parse(await newProjectHandler(makeCtx(), `answer ${expiredId} text`));
    expect(answerResult.type).toBe('new_project_error');
    expect(answerResult.message).toContain('Session expired');

    const doneResult = parse(await newProjectHandler(makeCtx(), `done ${expiredId}`));
    expect(doneResult.type).toBe('new_project_error');
    expect(doneResult.message).toContain('Session expired');

    const specResult = parse(await newProjectHandler(makeCtx(), `generate-spec ${expiredId}`));
    expect(specResult.type).toBe('new_project_error');
    expect(specResult.message).toContain('Session expired');

    const planResult = parse(await newProjectHandler(makeCtx(), `generate-plan ${expiredId}`));
    expect(planResult.type).toBe('new_project_error');
    expect(planResult.message).toContain('Session expired');
  });

  it('prevents /done when no answers have been provided', async () => {
    const provider = makeProvider(['First question?']);
    const ctx = makeCtx(provider);

    const start = parse(await newProjectHandler(ctx, 'start My app'));
    const sid = start.sessionId as string;

    const result = parse(await newProjectHandler(ctx, `done ${sid}`));
    expect(result.type).toBe('new_project_error');
    expect(result.message).toContain('no answers');
  });
});

// ---------------------------------------------------------------------------
// No-args flow (ask for idea first)
// ---------------------------------------------------------------------------

describe('integration: no-args start flow', () => {
  it('starts with no args then uses start sub-command with the idea', async () => {
    const provider = makeProvider(['What is the core feature?']);
    const ctx = makeCtx(provider);

    // Step 1: No args — get ask_idea prompt (no session created)
    const askIdea = parse(await newProjectHandler(ctx, ''));
    expect(askIdea.type).toBe('new_project_ask_idea');

    // Step 2: Start with idea — no need to cancel, no session was created
    const start = parse(await newProjectHandler(ctx, 'start A monitoring dashboard'));
    expect(start.type).toBe('new_project_question');
    expect(start.question).toBe('What is the core feature?');
  });
});
