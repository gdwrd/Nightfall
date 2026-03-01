import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatMessage, ProviderAdapter } from '@nightfall/shared';
import {
  NewProjectSessionManager,
  deriveSlug,
  MAX_QUESTIONS,
  SPEC_BUILDER_SYSTEM_PROMPT,
  SPEC_COMPILATION_PROMPT,
  DEV_PLAN_PROMPT,
} from '../../new-project/index.js';
import type { NewProjectSession } from '../../new-project/index.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

// ---------------------------------------------------------------------------
// Module-level session manager (shared across all handler invocations)
// ---------------------------------------------------------------------------

const sessionManager = new NewProjectSessionManager();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from a streaming provider into a single string. */
async function collectResponse(
  provider: ProviderAdapter,
  messages: ChatMessage[],
): Promise<string> {
  let full = '';
  for await (const chunk of provider.complete(messages)) {
    full += chunk;
  }
  return full.trim();
}

/** Format session history as a readable conversation string. */
function formatConversation(session: NewProjectSession): string {
  const lines: string[] = [`User's idea: ${session.idea}`, ''];
  for (const entry of session.history) {
    const label = entry.role === 'assistant' ? 'Q' : 'A';
    lines.push(`${label}: ${entry.content}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Sub-command handlers
// ---------------------------------------------------------------------------

function handleStart(
  ctx: CommandDispatcherContext,
  idea: string,
): { session: NewProjectSession; provider: ProviderAdapter } {
  if (!idea) {
    throw new HandlerError('Please provide an idea for your project.');
  }

  if (sessionManager.hasActive()) {
    throw new HandlerError(
      'A wizard session is already in progress. Type /cancel to start over.',
    );
  }

  const session = sessionManager.create(idea);
  return { session, provider: ctx.provider };
}

async function handleAnswer(
  ctx: CommandDispatcherContext,
  sessionId: string,
  answer: string,
): Promise<string> {
  const session = getSessionOrThrow(sessionId);

  if (session.status !== 'gathering') {
    throw new HandlerError('Q&A has already ended for this session.');
  }

  const provider = ctx.provider;

  // Build conversation messages including the new answer, but do NOT push
  // to session.history yet — if the LLM call fails we don't want orphaned
  // user entries that corrupt the alternating assistant/user pattern.
  const messages: ChatMessage[] = [
    { role: 'system', content: SPEC_BUILDER_SYSTEM_PROMPT },
    { role: 'user', content: `Here's the idea:\n\n${session.idea}` },
    ...session.history.map((h) => ({
      role: h.role as ChatMessage['role'],
      content: h.content,
    })),
    { role: 'user', content: answer },
  ];

  let response: string;
  try {
    response = await collectResponse(provider, messages);
  } catch (err) {
    // Clean up session so the user isn't permanently locked out of the wizard
    sessionManager.delete(session.id);
    throw err;
  }

  // Record only after successful LLM call
  session.history.push({ role: 'user', content: answer });
  session.questionCount++;

  // Record the LLM's response in history (strip sentinel if present)
  const cleanResponse = response.replace(/\[SPEC_READY\]/g, '').trim();
  if (cleanResponse) {
    session.history.push({ role: 'assistant', content: cleanResponse });
  }

  // Check for [SPEC_READY] sentinel or max questions reached
  if (response.includes('[SPEC_READY]') || session.questionCount >= MAX_QUESTIONS) {
    session.status = 'ready_to_compile';
    return JSON.stringify({
      type: 'new_project_gathering_complete',
      sessionId: session.id,
      questionCount: session.questionCount,
    });
  }

  return JSON.stringify({
    type: 'new_project_question',
    sessionId: session.id,
    questionNumber: session.questionCount,
    question: response,
  });
}

function handleDone(sessionId: string): string {
  const session = getSessionOrThrow(sessionId);

  const hasUserAnswers = session.history.some((h) => h.role === 'user');
  if (!hasUserAnswers) {
    throw new HandlerError('Cannot finish Q&A — no answers have been provided yet.');
  }

  session.status = 'ready_to_compile';
  return JSON.stringify({
    type: 'new_project_gathering_complete',
    sessionId: session.id,
    questionCount: session.questionCount,
  });
}

async function handleGenerateSpec(
  ctx: CommandDispatcherContext,
  sessionId: string,
): Promise<string> {
  const session = getSessionOrThrow(sessionId);

  if (session.status !== 'ready_to_compile') {
    throw new HandlerError('Q&A is not complete yet. Finish answering questions first.');
  }

  const provider = ctx.provider;

  const conversationText = formatConversation(session);
  const systemPrompt = SPEC_COMPILATION_PROMPT.replace(
    '{conversation_history}',
    conversationText,
  );

  const spec = await collectResponse(provider, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the specification now.' },
  ]);

  // Save spec to spec/ folder
  const slug = session.projectSlug || deriveSlug(session.idea);
  const specDir = path.join(ctx.projectRoot, 'spec');
  await fs.mkdir(specDir, { recursive: true });
  const specPath = path.join(specDir, `${slug}.md`);
  await fs.writeFile(specPath, spec, 'utf-8');

  session.specPath = specPath;
  session.status = 'spec_saved';

  return JSON.stringify({
    type: 'new_project_spec_saved',
    sessionId: session.id,
    specPath,
  });
}

async function handleGeneratePlan(
  ctx: CommandDispatcherContext,
  sessionId: string,
): Promise<string> {
  const session = getSessionOrThrow(sessionId);
  const provider = ctx.provider;

  if (!session.specPath) {
    throw new HandlerError('No spec has been generated yet. Generate the spec first.');
  }

  const specContent = await fs.readFile(session.specPath, 'utf-8');
  const systemPrompt = DEV_PLAN_PROMPT.replace('{specification}', specContent);

  const plan = await collectResponse(provider, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the development plan now.' },
  ]);

  // Save plan alongside the spec
  const slug = session.projectSlug || deriveSlug(session.idea);
  const specDir = path.dirname(session.specPath);
  const planPath = path.join(specDir, `${slug}-plan.md`);
  await fs.writeFile(planPath, plan, 'utf-8');

  session.planPath = planPath;
  session.status = 'plan_saved';

  const result = JSON.stringify({
    type: 'new_project_plan_saved',
    sessionId: session.id,
    specPath: session.specPath,
    planPath,
  });

  // Cleanup session after plan is saved
  sessionManager.delete(session.id);

  return result;
}

function handleCancel(sessionId: string): string {
  const session = sessionManager.get(sessionId);
  const specPath = session?.specPath ?? null;

  if (session) {
    sessionManager.delete(sessionId);
  }

  return JSON.stringify({
    type: 'new_project_done',
    sessionId,
    specPath,
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

class HandlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandlerError';
  }
}

function getSessionOrThrow(sessionId: string): NewProjectSession {
  const session = sessionManager.get(sessionId);
  if (!session) {
    throw new HandlerError('Session expired or not found. Start over with /new-project.');
  }
  return session;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handler for the /new-project slash command.
 *
 * Sub-commands:
 *   (empty)                  → Start new session, ask for idea
 *   start <idea>             → Start new session with idea pre-filled
 *   answer <sessionId> <text>→ Submit user answer, get next question
 *   done <sessionId>         → End Q&A early, move to spec compilation
 *   generate-spec <sessionId>→ Compile spec from Q&A history
 *   generate-plan <sessionId>→ Generate dev plan from saved spec
 *   cancel <sessionId>       → Abort wizard, clean up session
 */
export async function newProjectHandler(
  ctx: CommandDispatcherContext,
  args: string,
): Promise<string> {
  const trimmed = args.trim();

  try {
    // /new-project (no args) → ask for idea (no session created yet)
    if (!trimmed) {
      if (sessionManager.hasActive()) {
        return JSON.stringify({
          type: 'new_project_error',
          message: 'A wizard session is already in progress. Type /cancel to start over.',
        });
      }
      return JSON.stringify({
        type: 'new_project_ask_idea',
      });
    }

    // /new-project start <idea>
    if (trimmed === 'start' || trimmed.startsWith('start ')) {
      const idea = trimmed === 'start' ? '' : trimmed.slice('start '.length).trim();
      const { session, provider } = handleStart(ctx, idea);

      // Get the first question from the LLM. If this fails, clean up the
      // session so the user isn't permanently locked out of the wizard.
      let response: string;
      try {
        const messages: ChatMessage[] = [
          { role: 'system', content: SPEC_BUILDER_SYSTEM_PROMPT },
          { role: 'user', content: `Here's the idea:\n\n${idea}` },
        ];
        response = await collectResponse(provider, messages);
      } catch (err) {
        sessionManager.delete(session.id);
        throw err;
      }
      session.history.push({ role: 'assistant', content: response });

      return JSON.stringify({
        type: 'new_project_question',
        sessionId: session.id,
        questionNumber: 0,
        question: response,
      });
    }

    // /new-project answer <sessionId> <answer>
    if (trimmed.startsWith('answer ')) {
      const rest = trimmed.slice('answer '.length);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) {
        return JSON.stringify({
          type: 'new_project_error',
          message: 'Usage: /new-project answer <sessionId> <your answer>',
        });
      }
      const sessionId = rest.slice(0, spaceIdx);
      const answer = rest.slice(spaceIdx + 1).trim();
      if (!answer) {
        return JSON.stringify({
          type: 'new_project_error',
          message: 'Answer cannot be empty.',
        });
      }
      return await handleAnswer(ctx, sessionId, answer);
    }

    // /new-project done <sessionId>
    if (trimmed === 'done' || trimmed.startsWith('done ')) {
      const sessionId = trimmed === 'done' ? '' : trimmed.slice('done '.length).trim();
      return handleDone(sessionId);
    }

    // /new-project generate-spec <sessionId>
    if (trimmed.startsWith('generate-spec ')) {
      const sessionId = trimmed.slice('generate-spec '.length).trim();
      return await handleGenerateSpec(ctx, sessionId);
    }

    // /new-project generate-plan <sessionId>
    if (trimmed.startsWith('generate-plan ')) {
      const sessionId = trimmed.slice('generate-plan '.length).trim();
      return await handleGeneratePlan(ctx, sessionId);
    }

    // /new-project cancel <sessionId>
    if (trimmed.startsWith('cancel ')) {
      const sessionId = trimmed.slice('cancel '.length).trim();
      return handleCancel(sessionId);
    }

    return JSON.stringify({
      type: 'new_project_error',
      message: `Unknown sub-command: ${trimmed.split(' ')[0]}. Available: start, answer, done, generate-spec, generate-plan, cancel`,
    });
  } catch (err) {
    if (err instanceof HandlerError) {
      return JSON.stringify({
        type: 'new_project_error',
        message: err.message,
      });
    }
    return JSON.stringify({
      type: 'new_project_error',
      message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// Exported for testing
export { sessionManager as _testSessionManager };
