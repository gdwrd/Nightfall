import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProviderAdapter, ChatMessage } from '@nightfall/shared';
import { newProjectHandler, _testSessionManager } from './new-project.handler.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeProvider(responses: string[] = []): ProviderAdapter {
  let idx = 0;
  return {
    async *complete(_messages: ChatMessage[]): AsyncGenerator<string> {
      const response = responses[idx++] ?? 'What framework do you want to use?';
      yield response;
    },
    isAvailable: async () => true,
    ensureModelReady: async () => {},
  };
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightfall-newproj-'));
  // Clear any leftover sessions between tests
  // Access the internal sessions map through the exported manager
  const sessions = (_testSessionManager as unknown as { sessions: Map<string, unknown> }).sessions;
  sessions.clear();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// /new-project (no args) — ask for idea
// ---------------------------------------------------------------------------

describe('newProjectHandler — no args', () => {
  it('returns new_project_ask_idea with a sessionId', async () => {
    const result = await newProjectHandler(makeCtx(), '');
    const data = parse(result);
    expect(data.type).toBe('new_project_ask_idea');
    expect(data.sessionId).toBeDefined();
    expect(typeof data.sessionId).toBe('string');
  });

  it('returns error when a session is already active', async () => {
    // Start one session
    await newProjectHandler(makeCtx(), '');
    // Try to start another
    const result = await newProjectHandler(makeCtx(), '');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('already in progress');
  });
});

// ---------------------------------------------------------------------------
// /new-project start <idea>
// ---------------------------------------------------------------------------

describe('newProjectHandler — start', () => {
  it('creates session and returns first question from LLM', async () => {
    const provider = makeProvider(['What is the primary user persona?']);
    const result = await newProjectHandler(makeCtx(provider), 'start A task management app');
    const data = parse(result);
    expect(data.type).toBe('new_project_question');
    expect(data.sessionId).toBeDefined();
    expect(data.questionNumber).toBe(0);
    expect(data.question).toBe('What is the primary user persona?');
  });

  it('returns error when idea is empty', async () => {
    const result = await newProjectHandler(makeCtx(), 'start ');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('provide an idea');
  });
});

// ---------------------------------------------------------------------------
// /new-project answer <sessionId> <text>
// ---------------------------------------------------------------------------

describe('newProjectHandler — answer', () => {
  it('feeds answer and returns next question', async () => {
    const provider = makeProvider([
      'Who is the target user?',
      'What platforms should it support?',
    ]);
    // Start session
    const startResult = parse(await newProjectHandler(makeCtx(provider), 'start My app'));
    const sessionId = startResult.sessionId as string;

    // Answer
    const result = await newProjectHandler(
      makeCtx(provider),
      `answer ${sessionId} Developers who need a CLI tool`,
    );
    const data = parse(result);
    expect(data.type).toBe('new_project_question');
    expect(data.question).toBe('What platforms should it support?');
  });

  it('returns gathering_complete when LLM responds with [SPEC_READY]', async () => {
    const provider = makeProvider([
      'Who is the target user?',
      'I have enough information. [SPEC_READY]',
    ]);
    const startResult = parse(await newProjectHandler(makeCtx(provider), 'start My app'));
    const sessionId = startResult.sessionId as string;

    const result = await newProjectHandler(
      makeCtx(provider),
      `answer ${sessionId} Developers`,
    );
    const data = parse(result);
    expect(data.type).toBe('new_project_gathering_complete');
    expect(data.sessionId).toBe(sessionId);
  });

  it('returns error for invalid sessionId', async () => {
    const result = await newProjectHandler(makeCtx(), 'answer bad-id My answer');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('Session expired');
  });

  it('returns error when answer text is missing', async () => {
    const result = await newProjectHandler(makeCtx(), 'answer bad-id-only');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('Usage');
  });
});

// ---------------------------------------------------------------------------
// /new-project done <sessionId>
// ---------------------------------------------------------------------------

describe('newProjectHandler — done', () => {
  it('moves session to ready_to_compile', async () => {
    const provider = makeProvider(['Who is the target user?', 'Another question']);
    const startResult = parse(await newProjectHandler(makeCtx(provider), 'start My app'));
    const sessionId = startResult.sessionId as string;

    // Provide at least one answer
    await newProjectHandler(makeCtx(provider), `answer ${sessionId} Developers`);

    const result = await newProjectHandler(makeCtx(provider), `done ${sessionId}`);
    const data = parse(result);
    expect(data.type).toBe('new_project_gathering_complete');
    expect(data.sessionId).toBe(sessionId);
  });

  it('returns error when no answers have been provided', async () => {
    const provider = makeProvider(['Who is the target user?']);
    const startResult = parse(await newProjectHandler(makeCtx(provider), 'start My app'));
    const sessionId = startResult.sessionId as string;

    const result = await newProjectHandler(makeCtx(provider), `done ${sessionId}`);
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('no answers');
  });

  it('returns error for invalid sessionId', async () => {
    const result = await newProjectHandler(makeCtx(), 'done bad-id');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('Session expired');
  });
});

// ---------------------------------------------------------------------------
// /new-project generate-spec <sessionId>
// ---------------------------------------------------------------------------

describe('newProjectHandler — generate-spec', () => {
  it('compiles spec and saves to file', async () => {
    const provider = makeProvider([
      'Who is the target user?',
      'I have enough. [SPEC_READY]',
      '# My App Spec\n\nThis is the spec content.',
    ]);
    const ctx = makeCtx(provider);

    // Start + answer + auto-complete
    const startResult = parse(await newProjectHandler(ctx, 'start My task app'));
    const sessionId = startResult.sessionId as string;
    await newProjectHandler(ctx, `answer ${sessionId} Developers`);

    // Generate spec
    const result = await newProjectHandler(ctx, `generate-spec ${sessionId}`);
    const data = parse(result);
    expect(data.type).toBe('new_project_spec_saved');
    expect(data.specPath).toBeDefined();

    // Verify file was created
    const specContent = await fs.readFile(data.specPath as string, 'utf-8');
    expect(specContent).toContain('My App Spec');
  });

  it('returns error for invalid sessionId', async () => {
    const result = await newProjectHandler(makeCtx(), 'generate-spec bad-id');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('Session expired');
  });
});

// ---------------------------------------------------------------------------
// /new-project generate-plan <sessionId>
// ---------------------------------------------------------------------------

describe('newProjectHandler — generate-plan', () => {
  it('generates plan from saved spec and saves to file', async () => {
    const provider = makeProvider([
      'Who is the target user?',
      'I have enough. [SPEC_READY]',
      '# My App Spec\n\nSpec content here.',
      '# My App Plan\n\n## Phase 1\n\nDo stuff.',
    ]);
    const ctx = makeCtx(provider);

    // Full flow: start → answer → generate-spec → generate-plan
    const startResult = parse(await newProjectHandler(ctx, 'start My task app'));
    const sessionId = startResult.sessionId as string;
    await newProjectHandler(ctx, `answer ${sessionId} Developers`);
    await newProjectHandler(ctx, `generate-spec ${sessionId}`);

    const result = await newProjectHandler(ctx, `generate-plan ${sessionId}`);
    const data = parse(result);
    expect(data.type).toBe('new_project_plan_saved');
    expect(data.planPath).toBeDefined();

    // Verify file was created
    const planContent = await fs.readFile(data.planPath as string, 'utf-8');
    expect(planContent).toContain('My App Plan');
  });

  it('returns error when spec has not been generated yet', async () => {
    const provider = makeProvider([
      'Who is the target user?',
      'More questions. [SPEC_READY]',
    ]);
    const ctx = makeCtx(provider);

    const startResult = parse(await newProjectHandler(ctx, 'start My task app'));
    const sessionId = startResult.sessionId as string;
    await newProjectHandler(ctx, `answer ${sessionId} Devs`);

    const result = await newProjectHandler(ctx, `generate-plan ${sessionId}`);
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('No spec');
  });
});

// ---------------------------------------------------------------------------
// /new-project cancel <sessionId>
// ---------------------------------------------------------------------------

describe('newProjectHandler — cancel', () => {
  it('cleans up session and returns done', async () => {
    const provider = makeProvider(['Who is the target user?']);
    const startResult = parse(await newProjectHandler(makeCtx(provider), 'start My app'));
    const sessionId = startResult.sessionId as string;

    const result = await newProjectHandler(makeCtx(provider), `cancel ${sessionId}`);
    const data = parse(result);
    expect(data.type).toBe('new_project_done');
    expect(data.sessionId).toBe(sessionId);
  });

  it('returns done even for unknown sessionId (idempotent)', async () => {
    const result = await newProjectHandler(makeCtx(), 'cancel unknown-id');
    const data = parse(result);
    expect(data.type).toBe('new_project_done');
  });
});

// ---------------------------------------------------------------------------
// Unknown sub-command
// ---------------------------------------------------------------------------

describe('newProjectHandler — unknown sub-command', () => {
  it('returns error for unknown sub-commands', async () => {
    const result = await newProjectHandler(makeCtx(), 'foobar something');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('Unknown sub-command');
  });
});

// ---------------------------------------------------------------------------
// LLM failure handling
// ---------------------------------------------------------------------------

describe('newProjectHandler — LLM failure', () => {
  it('returns error when provider throws', async () => {
    const provider: ProviderAdapter = {
      // eslint-disable-next-line require-yield
      async *complete(): AsyncGenerator<string> {
        throw new Error('Connection refused');
      },
      isAvailable: async () => true,
      ensureModelReady: async () => {},
    };
    const ctx = makeCtx(provider);

    const result = await newProjectHandler(ctx, 'start My app');
    const data = parse(result);
    expect(data.type).toBe('new_project_error');
    expect(data.message).toContain('Connection refused');
  });
});
