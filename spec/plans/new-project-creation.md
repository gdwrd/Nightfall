# New Project Creation Feature — Implementation Plan

> Add an interactive wizard that helps users brainstorm, spec out, and plan new projects from scratch — all within Nightfall's terminal UI.

---

## Feature Overview

When a user invokes `/new-project` (or submits a free-text message that signals "new project" intent), Nightfall enters a guided conversation mode. An LLM-powered "spec builder" asks one question at a time, building on previous answers, until it has enough context to produce a comprehensive, developer-ready specification. The spec is saved to a `spec/` folder. The user is then offered the option to generate a step-by-step development plan, which is also saved.

### User-Facing Flow

```
1. User types /new-project
     or types "I want to build a ..." (natural language trigger)
2. System asks: "What would you like to build? Describe your idea."
     (skipped if the idea was already in the free-text message)
3. Iterative Q&A — one question at a time:
     Q1: "Who is the target user for this project?"
     A1: "developers who ..."
     Q2: "What's the core workflow they'd go through?"
     A2: ...
     (continues until the LLM has enough detail — typically 5-15 questions)
4. User can type /done at any point to end Q&A early
5. System generates a comprehensive specification → saves to spec/<project-slug>.md
6. System asks: "Would you like me to create a detailed step-by-step development plan?"
7. If yes → generates plan → saves to spec/<project-slug>-plan.md
8. Returns to idle
```

---

## Architecture Decision

### Approach: Slash Command Sub-Commands + Session State

The feature uses the existing `SLASH_COMMAND` / `SLASH_RESULT` WebSocket flow with sub-commands and a server-side session object. This avoids adding new WebSocket message types and keeps the change footprint minimal.

**Why not new WebSocket message types?**
- The existing SLASH pattern handles async request→response well
- The CLI already handles JSON payloads from slash results (model, settings, history)
- Adding new WS types would require changes across shared, core server, CLI client — high coupling for a feature that's conceptually a "multi-step command"

**Session state is held server-side** in the handler (via a `Map<string, NewProjectSession>`), so the CLI remains stateless and only renders what the server sends.

---

## Implementation Phases

| # | Phase | Package(s) | Depends On |
|---|-------|-----------|------------|
| 1 | Session & Prompts | `core` | — |
| 2 | Command Handler | `core` | 1 |
| 3 | CLI State & Actions | `cli` | — |
| 4 | NewProjectWizard Component | `cli` | 3 |
| 5 | App.tsx Integration | `cli` | 2, 4 |
| 6 | Natural Language Trigger | `core` + `cli` | 2, 5 |
| 7 | Tests | `core` + `cli` | all |

---

## Phase 1 — Session & Prompts

### Task 1: Session & Prompts

- [x] Create `packages/core/src/new-project/new-project.session.ts` with `NewProjectSession` interface, `NewProjectSessionManager` class, and `deriveSlug` helper
- [x] Create `packages/core/src/new-project/new-project.prompts.ts` with `SPEC_BUILDER_SYSTEM_PROMPT`, `SPEC_COMPILATION_PROMPT`, and `DEV_PLAN_PROMPT`
- [x] Create `packages/core/src/new-project/index.ts` barrel export
- [x] Add new-project exports to `packages/core/src/index.ts`
- [x] Write unit tests for session manager and slug derivation
- [x] All tests and lint pass

### Files to Create

#### `packages/core/src/new-project/new-project.session.ts`

Manages the state of one brainstorming session.

```typescript
export interface NewProjectSession {
  id: string;
  idea: string;                    // Initial idea from user
  history: { role: 'assistant' | 'user'; content: string }[];
  questionCount: number;
  status: 'gathering' | 'ready_to_compile' | 'spec_saved' | 'plan_saved' | 'done';
  specPath: string | null;
  planPath: string | null;
  projectSlug: string | null;
}

export class NewProjectSessionManager {
  private sessions = new Map<string, NewProjectSession>();

  create(idea: string): NewProjectSession;
  get(sessionId: string): NewProjectSession | undefined;
  delete(sessionId: string): void;
}
```

**Key behavior:**
- `create()` generates a UUID session ID, stores initial idea
- Conversation history is accumulated in `history[]` — each user answer and LLM question is appended
- The session is the single source of truth for the wizard state

#### `packages/core/src/new-project/new-project.prompts.ts`

Contains the system prompts for both phases.

**Spec Builder System Prompt** (used during iterative Q&A):
```
You are a product specification expert helping a user define a new software project.

Your goal is to ask focused, specific questions ONE AT A TIME to build a thorough
understanding of the project. Each question should build on the user's previous
answers and dig deeper into relevant details.

Cover these areas (not necessarily in order — adapt to the conversation):
- Core problem and target users
- Key features and user workflows
- Technical requirements (platforms, integrations, data storage)
- Architecture preferences (monolith vs microservices, frontend framework, etc.)
- Authentication and authorization needs
- Data model and relationships
- API design (if applicable)
- Error handling and edge cases
- Performance and scaling requirements
- Testing strategy
- MVP scope vs future features

When you have gathered enough detail to write a comprehensive specification,
respond with exactly: [SPEC_READY]

Otherwise, respond with your next question only — no preamble, no numbering,
just the question.
```

**Spec Compilation Prompt** (used to generate the final spec):
```
You are a senior software architect. Based on the following brainstorming
conversation, compile a comprehensive, developer-ready specification.

The specification must include:

1. **Project Overview** — Name, one-paragraph summary, target users
2. **Core Requirements** — Numbered list of must-have features
3. **User Workflows** — Step-by-step flows for each key user journey
4. **Technical Architecture** — Stack choices, system diagram (ASCII),
   component breakdown
5. **Data Model** — Entities, relationships, key fields
6. **API Design** — Endpoints or interface contracts (if applicable)
7. **Authentication & Authorization** — Strategy, roles, permissions
8. **Error Handling** — Strategy for validation, network failures, edge cases
9. **Testing Plan** — Unit, integration, E2E strategy with specific targets
10. **MVP Scope** — What's in v1 vs what's deferred
11. **Open Questions** — Anything that still needs clarification

Format the output as clean Markdown. Be specific and actionable — a developer
should be able to start implementation immediately from this document.

Brainstorming conversation:
<CONVERSATION>
{conversation_history}
</CONVERSATION>
```

**Development Plan Prompt** (used to generate the step-by-step plan):
```
You are a senior software architect creating a step-by-step development plan
from the following project specification.

Create a phased implementation plan that:

1. **Orders phases by dependency** — foundational work first, features that
   depend on other features later
2. **Each phase includes:**
   - Phase name and goal
   - Specific files to create or modify
   - Implementation details (not just "build X" — explain how)
   - Acceptance criteria (how to verify the phase is complete)
   - Estimated complexity (simple / moderate / complex)
3. **Identifies parallel work** — which phases can run concurrently
4. **Includes a testing phase** for each implementation phase
5. **Ends with integration and deployment** phases

Format as clean Markdown with clear phase numbering.

Project Specification:
<SPEC>
{specification}
</SPEC>
```

#### `packages/core/src/new-project/index.ts`

Barrel export for the module.

### Key Design Decisions

- The `[SPEC_READY]` sentinel in the LLM response is how the system detects that enough questions have been asked. The prompt instructs the LLM to emit this when satisfied.
- The spec builder uses the **provider already configured** in Nightfall — same model, same adapter. No special agent role needed; we call `provider.complete()` directly with the appropriate system prompt.
- Sessions are in-memory only. If the server restarts, sessions are lost. This is acceptable for a wizard flow that typically completes in one sitting.

---

## Phase 2 — Command Handler

### Task 2: Command Handler

- [x] Create `packages/core/src/commands/handlers/new-project.handler.ts` with sub-command routing (start, answer, done, generate-spec, generate-plan, cancel)
- [x] Add `provider` to `CommandDispatcherContext` interface
- [x] Register `/new-project` case in `command.dispatcher.ts`
- [x] Update `NightfallServer` to pass provider to dispatcher context
- [x] Write unit tests for the handler
- [x] All tests and lint pass

### Files to Create

#### `packages/core/src/commands/handlers/new-project.handler.ts`

The handler implements all sub-commands:

```typescript
export async function newProjectHandler(
  ctx: CommandDispatcherContext,
  args: string,
): Promise<string>
```

**Sub-command routing:**

| Args Pattern | Action |
|---|---|
| `""` (empty) | Start new session — ask for idea |
| `start <idea_text>` | Start new session with idea already provided |
| `answer <sessionId> <answer_text>` | Feed user's answer, get next question |
| `done <sessionId>` | End Q&A early, move to spec compilation |
| `generate-spec <sessionId>` | Compile spec from Q&A, save to file |
| `generate-plan <sessionId>` | Generate dev plan from saved spec, save to file |
| `cancel <sessionId>` | Abort wizard, clean up session |

**Response JSON payloads:**

```typescript
// Initial prompt (no idea provided)
{ type: 'new_project_ask_idea', sessionId: string }

// Question during Q&A
{ type: 'new_project_question', sessionId: string, questionNumber: number, question: string }

// Q&A complete, ready to compile
{ type: 'new_project_gathering_complete', sessionId: string, questionCount: number }

// Spec saved
{ type: 'new_project_spec_saved', sessionId: string, specPath: string }

// Ask about plan generation
{ type: 'new_project_ask_plan', sessionId: string }

// Plan saved — wizard complete
{ type: 'new_project_plan_saved', sessionId: string, planPath: string }

// Wizard cancelled or completed
{ type: 'new_project_done', sessionId: string }

// Error
{ type: 'new_project_error', message: string }
```

**LLM interaction for Q&A:**

```typescript
// Build messages array from session history
const messages = [
  { role: 'system', content: SPEC_BUILDER_SYSTEM_PROMPT },
  { role: 'user', content: `Here's the idea:\n\n${session.idea}` },
  ...session.history.map(h => ({ role: h.role, content: h.content })),
  { role: 'user', content: latestAnswer },
];

// Call provider
const response = await provider.complete(messages);

// Check for [SPEC_READY] sentinel
if (response.includes('[SPEC_READY]')) {
  session.status = 'ready_to_compile';
  return JSON.stringify({ type: 'new_project_gathering_complete', ... });
}

// Otherwise return the question
session.history.push({ role: 'user', content: latestAnswer });
session.history.push({ role: 'assistant', content: response });
return JSON.stringify({ type: 'new_project_question', question: response, ... });
```

**Spec file generation:**

```typescript
// Derive slug from idea (first few words, kebab-case)
const slug = deriveSlug(session.idea);

// Call LLM with compilation prompt
const spec = await provider.complete([
  { role: 'system', content: SPEC_COMPILATION_PROMPT.replace('{conversation_history}', formatted) },
  { role: 'user', content: 'Generate the specification now.' },
]);

// Save to spec/ folder in project root
const specDir = path.join(projectRoot, 'spec');
await fs.mkdir(specDir, { recursive: true });
const specPath = path.join(specDir, `${slug}.md`);
await fs.writeFile(specPath, spec, 'utf-8');
```

**Plan file generation:**

```typescript
const specContent = await fs.readFile(session.specPath!, 'utf-8');

const plan = await provider.complete([
  { role: 'system', content: DEV_PLAN_PROMPT.replace('{specification}', specContent) },
  { role: 'user', content: 'Generate the development plan now.' },
]);

const planPath = path.join(specDir, `${slug}-plan.md`);
await fs.writeFile(planPath, plan, 'utf-8');
```

### Files to Modify

#### `packages/core/src/commands/command.dispatcher.ts`

Add the `/new-project` case:

```typescript
import { newProjectHandler } from './handlers/new-project.handler.js';

// In dispatch():
case '/new-project':
  return newProjectHandler(this.ctx, args);
```

The handler needs access to the provider for LLM calls. The `CommandDispatcherContext` already has `orchestrator`, which has `options.provider`. We have two options:

**Option A:** Add `provider` to `CommandDispatcherContext` directly.
**Option B:** Expose a method on the orchestrator like `getProvider()`.

**Decision: Option A** — cleaner, avoids leaking orchestrator internals. The server already has the provider reference when constructing the dispatcher.

```typescript
export interface CommandDispatcherContext {
  config: NightfallConfig;
  projectRoot: string;
  orchestrator: TaskOrchestrator;
  provider: ProviderAdapter;          // ← add this
}
```

Update `NightfallServer` where it creates the `CommandDispatcherContext` to pass the provider through.

---

## Phase 3 — CLI State & Actions

### Task 3: CLI State & Actions

- [x] Add `new_project` to `AppPhase` type and `NewProjectWizardData` interface to `app.store.ts`
- [x] Add `SET_NEW_PROJECT`, `UPDATE_NEW_PROJECT`, `CLEAR_NEW_PROJECT` reducer cases
- [x] Add new action types to `app.actions.ts`
- [x] All tests and lint pass

### Files to Modify

#### `packages/cli/src/store/app.store.ts`

Add new phase and state:

```typescript
export type AppPhase =
  | ... // existing phases
  | 'new_project';                    // ← add this

export interface NewProjectWizardData {
  sessionId: string;
  status: 'asking_idea' | 'gathering' | 'compiling_spec' | 'asking_plan' | 'compiling_plan';
  currentQuestion: string | null;
  questionNumber: number;
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface AppState {
  ... // existing fields
  newProjectData: NewProjectWizardData | null;    // ← add this
}
```

Add reducer cases:

```typescript
case 'SET_NEW_PROJECT':
  return { ...state, phase: 'new_project', newProjectData: action.data };

case 'UPDATE_NEW_PROJECT':
  return {
    ...state,
    newProjectData: state.newProjectData
      ? { ...state.newProjectData, ...action.partial }
      : null,
  };

case 'CLEAR_NEW_PROJECT':
  return { ...state, phase: 'idle', newProjectData: null };
```

#### `packages/cli/src/store/app.actions.ts`

Add new action types:

```typescript
export type AppAction =
  | ... // existing actions
  | { type: 'SET_NEW_PROJECT'; data: NewProjectWizardData }
  | { type: 'UPDATE_NEW_PROJECT'; partial: Partial<NewProjectWizardData> }
  | { type: 'CLEAR_NEW_PROJECT' };
```

---

## Phase 4 — NewProjectWizard Component

### Task 4: NewProjectWizard Component

- [x] Create `packages/cli/src/components/NewProjectWizard.tsx` with full wizard UI
- [x] Render Q&A history, current question, spinner during compilation, plan confirmation
- [x] Handle `/done` and `/cancel` interception
- [x] All tests and lint pass

### Files to Create

#### `packages/cli/src/components/NewProjectWizard.tsx`

Full-screen component that renders the brainstorming wizard.

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ 🌑 NEW PROJECT WIZARD                        Question 3/~  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Q1: What would you like to build?                          │
│  → A social media scheduler for small businesses...         │
│                                                             │
│  Q2: Who is the primary user? A developer or a non-tech...  │
│  → Marketing managers at small businesses who don't have... │
│                                                             │
│  Q3: What social platforms should it support at launch?     │
│  (waiting for your answer)                                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ > _                               Type /done to finish Q&A  │
└─────────────────────────────────────────────────────────────┘
```

**Props:**

```typescript
interface NewProjectWizardProps {
  data: NewProjectWizardData;
  onAnswer: (answer: string) => void;     // User submits an answer
  onDone: () => void;                     // User types /done
  onCancel: () => void;                   // User types /cancel or Ctrl+C
  onConfirmPlan: (yes: boolean) => void;  // User answers plan question
}
```

**Behavior:**
- Renders scrollable Q&A history with alternating question/answer pairs
- Shows current question prominently at the bottom of the history
- Input bar accepts free text answers
- Intercepts `/done` to end Q&A early and `/cancel` to abort
- When `status === 'compiling_spec'` or `'compiling_plan'`, shows a spinner with "Generating..."
- When `status === 'asking_plan'`, shows "Specification saved! Generate a development plan? (y/n)"

---

## Phase 5 — App.tsx Integration

### Task 5: App.tsx Integration

- [x] Add slash result handling for `/new-project` in `App.tsx`
- [x] Add input handling for wizard mode in `App.tsx`
- [x] Add render section for the wizard component in `App.tsx`
- [x] Add `new_project` and `new_project_plan` input modes to `InputBar.tsx`
- [x] Register `/new-project` in `slash.commands.ts`
- [x] All tests and lint pass

### Files to Modify

#### `packages/cli/src/components/App.tsx`

**1. Add slash result handling for `/new-project`:**

In the `onSlashResult` handler (inside `useEffect`), add:

```typescript
if (payload.command === '/new-project') {
  try {
    const data = JSON.parse(payload.output);

    switch (data.type) {
      case 'new_project_ask_idea':
        dispatch({
          type: 'SET_NEW_PROJECT',
          data: {
            sessionId: data.sessionId,
            status: 'asking_idea',
            currentQuestion: 'What would you like to build? Describe your idea in a few sentences.',
            questionNumber: 0,
            history: [],
          },
        });
        return;

      case 'new_project_question':
        dispatch({
          type: 'UPDATE_NEW_PROJECT',
          partial: {
            status: 'gathering',
            currentQuestion: data.question,
            questionNumber: data.questionNumber,
          },
        });
        return;

      case 'new_project_gathering_complete':
        // Auto-trigger spec generation
        dispatch({
          type: 'UPDATE_NEW_PROJECT',
          partial: { status: 'compiling_spec', currentQuestion: null },
        });
        orchestrator.sendSlashCommand('/new-project', `generate-spec ${data.sessionId}`);
        return;

      case 'new_project_spec_saved':
        dispatch({
          type: 'UPDATE_NEW_PROJECT',
          partial: { status: 'asking_plan' },
        });
        return;

      case 'new_project_plan_saved':
        dispatch({ type: 'CLEAR_NEW_PROJECT' });
        dispatch({
          type: 'SET_SLASH_OUTPUT',
          output: `✓ Project spec and plan saved!\n  Spec: ${data.planPath.replace(/-plan\.md$/, '.md')}\n  Plan: ${data.planPath}`,
        });
        return;

      case 'new_project_done':
        dispatch({ type: 'CLEAR_NEW_PROJECT' });
        dispatch({
          type: 'SET_SLASH_OUTPUT',
          output: data.specPath
            ? `✓ Project spec saved to ${data.specPath}`
            : 'New project wizard cancelled.',
        });
        return;

      case 'new_project_error':
        dispatch({ type: 'CLEAR_NEW_PROJECT' });
        dispatch({ type: 'SET_SLASH_OUTPUT', output: `Error: ${data.message}` });
        return;
    }
  } catch {
    // Not JSON — fall through
  }
}
```

**2. Add input handling for wizard mode:**

In `handleInput()`, before the slash command check, add:

```typescript
// New project wizard mode
if (phase === 'new_project' && state.newProjectData) {
  const { sessionId, status } = state.newProjectData;

  if (input.toLowerCase() === '/cancel') {
    orchestrator.sendSlashCommand('/new-project', `cancel ${sessionId}`);
    return;
  }

  if (status === 'asking_idea') {
    // User provided their idea
    dispatch({
      type: 'UPDATE_NEW_PROJECT',
      partial: {
        status: 'gathering',
        history: [
          { role: 'assistant', content: state.newProjectData.currentQuestion! },
          { role: 'user', content: input },
        ],
      },
    });
    orchestrator.sendSlashCommand('/new-project', `start ${input}`);
    return;
  }

  if (status === 'gathering') {
    if (input.toLowerCase() === '/done') {
      dispatch({
        type: 'UPDATE_NEW_PROJECT',
        partial: { status: 'compiling_spec', currentQuestion: null },
      });
      orchestrator.sendSlashCommand('/new-project', `done ${sessionId}`);
      return;
    }
    // Regular answer
    dispatch({
      type: 'UPDATE_NEW_PROJECT',
      partial: {
        history: [
          ...state.newProjectData.history,
          { role: 'user', content: input },
        ],
      },
    });
    orchestrator.sendSlashCommand('/new-project', `answer ${sessionId} ${input}`);
    return;
  }

  if (status === 'asking_plan') {
    const lower = input.toLowerCase();
    if (lower === 'y' || lower === 'yes') {
      dispatch({
        type: 'UPDATE_NEW_PROJECT',
        partial: { status: 'compiling_plan' },
      });
      orchestrator.sendSlashCommand('/new-project', `generate-plan ${sessionId}`);
    } else {
      orchestrator.sendSlashCommand('/new-project', `cancel ${sessionId}`);
    }
    return;
  }

  return; // Swallow input during compiling states
}
```

**3. Add render section for the wizard:**

```typescript
// New project wizard
if (phase === 'new_project' && state.newProjectData) {
  return (
    <NewProjectWizard
      data={state.newProjectData}
      onAnswer={(answer) => handleInput(answer)}
      onDone={() => handleInput('/done')}
      onCancel={() => handleInput('/cancel')}
      onConfirmPlan={(yes) => handleInput(yes ? 'y' : 'n')}
    />
  );
}
```

**4. Add InputBar mode:**

In `InputBar.tsx`, add a `'new_project'` mode:

```typescript
export type InputMode =
  | ... // existing modes
  | 'new_project'        // answering wizard questions
  | 'new_project_plan';  // confirming plan generation (y/n)
```

With appropriate placeholder text:
- `'new_project'` → `"Type your answer or /done to finish Q&A"`
- `'new_project_plan'` → `"y to generate plan · n to skip"`

#### `packages/cli/src/slash.commands.ts`

Register the new command for autocomplete:

```typescript
export const SLASH_COMMANDS: Record<string, string> = {
  ... // existing commands
  '/new-project': 'Start a guided wizard to spec out a new project',
};
```

---

## Phase 6 — Natural Language Trigger

### Task 6: Natural Language Trigger

- [ ] Update classifier prompt in `agent.factory.ts` to detect `new_project` intent
- [ ] Update `parseClassification()` and `submitTask()` in `task.orchestrator.ts` to route `new_project` intent
- [ ] Implement `routeToNewProject` method on orchestrator
- [ ] All tests and lint pass

Allow users to start the new-project flow by simply typing something like "I want to build a task management app" without using `/new-project`.

### Approach

Extend the classifier agent to detect a third intent: `'new_project'`.

### Files to Modify

#### `packages/core/src/orchestrator/agent.factory.ts`

Update the `CLASSIFIER_PROMPT` to include the `new_project` type:

```
Classify the user's message into one of three categories:
- "coding_task" — the user wants to modify, fix, or add code to an existing project
- "question" — the user is asking a question about the codebase or technology
- "new_project" — the user wants to create or brainstorm a new project from scratch

Respond with JSON: { "type": "coding_task" | "question" | "new_project" }
```

**Detection heuristics** (in the prompt):
- Mentions "build", "create", "start", "new project", "new app", "from scratch"
- Describes an idea rather than referencing existing files
- No references to specific files, functions, or existing code

#### `packages/core/src/orchestrator/task.orchestrator.ts`

Update `parseClassification()` and `submitTask()`:

```typescript
private parseClassification(summary: string): 'coding_task' | 'question' | 'new_project' {
  try {
    const parsed = JSON.parse(summary);
    if (parsed.type === 'question') return 'question';
    if (parsed.type === 'new_project') return 'new_project';
  } catch {}
  return 'coding_task';
}
```

In `submitTask()`, add routing for `new_project`:

```typescript
if (requestType === 'new_project') {
  return this.routeToNewProject(run, prompt);
}
```

The `routeToNewProject` method would emit a special task status that the CLI interprets to enter the wizard with the idea pre-filled, effectively behaving as if the user typed `/new-project start <their message>`.

### New ServerMessage Consideration

To avoid overloading the task status flow, the simplest approach is to have the orchestrator send a `SLASH_RESULT` message with the `new_project_question` payload, mimicking the slash command flow. This keeps the CLI handling uniform.

---

## Phase 7 — Tests

### Task 7: Integration Tests

- [ ] Create `packages/core/src/commands/handlers/__tests__/new-project.handler.test.ts` with handler integration tests
- [ ] Test all sub-command flows (start, answer, done, generate-spec, generate-plan, cancel, errors)
- [ ] All tests and lint pass

### Files to Create

#### `packages/core/src/new-project/__tests__/new-project.session.test.ts`

- Session creation and ID generation
- History accumulation
- Status transitions
- Slug derivation from idea text

#### `packages/core/src/commands/handlers/__tests__/new-project.handler.test.ts`

- Empty args → returns `new_project_ask_idea`
- `start <idea>` → creates session, calls LLM, returns first question
- `answer <id> <text>` → feeds answer, returns next question
- `answer` when LLM returns `[SPEC_READY]` → returns `gathering_complete`
- `done <id>` → moves to `ready_to_compile`
- `generate-spec <id>` → calls LLM with compilation prompt, writes file, returns `spec_saved`
- `generate-plan <id>` → calls LLM with plan prompt, writes file, returns `plan_saved`
- `cancel <id>` → cleans up session, returns `done`
- Invalid session ID → returns error
- LLM failure → returns error gracefully

#### `packages/cli/src/components/__tests__/NewProjectWizard.test.tsx`

- Renders initial "ask idea" state
- Renders Q&A history correctly
- Renders current question
- Shows spinner during compilation
- Shows plan confirmation prompt
- Input submission calls onAnswer
- `/done` triggers onDone
- `/cancel` triggers onCancel

---

## File Summary

### New Files (7)

| File | Package | Description |
|------|---------|-------------|
| `packages/core/src/new-project/new-project.session.ts` | core | Session state management |
| `packages/core/src/new-project/new-project.prompts.ts` | core | System prompts for spec builder, compiler, planner |
| `packages/core/src/new-project/index.ts` | core | Barrel export |
| `packages/core/src/commands/handlers/new-project.handler.ts` | core | Slash command handler with sub-command routing |
| `packages/cli/src/components/NewProjectWizard.tsx` | cli | Terminal UI wizard component |
| `packages/core/src/new-project/__tests__/new-project.session.test.ts` | core | Unit tests for session |
| `packages/core/src/commands/handlers/__tests__/new-project.handler.test.ts` | core | Handler integration tests |

### Modified Files (8)

| File | Package | Change |
|------|---------|--------|
| `packages/core/src/commands/command.dispatcher.ts` | core | Add `/new-project` case + import |
| `packages/shared/src/websocket.types.ts` | shared | (no changes — reuses existing types) |
| `packages/cli/src/store/app.store.ts` | cli | Add `new_project` phase, `NewProjectWizardData`, reducer cases |
| `packages/cli/src/store/app.actions.ts` | cli | Add `SET_NEW_PROJECT`, `UPDATE_NEW_PROJECT`, `CLEAR_NEW_PROJECT` |
| `packages/cli/src/components/App.tsx` | cli | Wire wizard result parsing, input handling, render |
| `packages/cli/src/components/InputBar.tsx` | cli | Add `new_project` and `new_project_plan` modes |
| `packages/cli/src/slash.commands.ts` | cli | Register `/new-project` in command list |
| `packages/core/src/orchestrator/agent.factory.ts` | core | Update classifier prompt (Phase 6) |

---

## Provider Interaction Detail

The handler calls the LLM via the `ProviderAdapter` interface, which supports streaming. For the wizard:

- **Q&A questions**: Use non-streaming `complete()` since responses are short (one question). If only streaming is available, collect the full response before returning.
- **Spec compilation**: Use streaming if possible — the response is long. The handler collects the full response, saves the file, then returns the result. The CLI shows a spinner during this time.
- **Plan generation**: Same as spec compilation — streaming + collect.

The handler receives the provider through the extended `CommandDispatcherContext`. The provider's `complete()` method is an `AsyncGenerator<string>` that yields chunks. The handler should collect all chunks into a full string:

```typescript
async function collectResponse(
  provider: ProviderAdapter,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
): Promise<string> {
  let full = '';
  for await (const chunk of provider.complete(/* formatted prompt */, systemPrompt)) {
    full += chunk;
  }
  return full.trim();
}
```

---

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| LLM returns malformed response | Retry once; if still malformed, ask user to rephrase |
| LLM never says `[SPEC_READY]` | After 20 questions, auto-trigger spec compilation |
| User types `/done` after 0 answers | Require at least the initial idea before allowing `/done` |
| Session not found (server restart) | Return clear error: "Session expired. Start over with /new-project" |
| File write fails (permissions) | Return error with path and errno |
| User submits `/new-project` while already in wizard | Return error: "Wizard already in progress. Type /cancel to start over." |
| Ctrl+C during wizard | Cancel session, return to idle |
| LLM call times out | Return timeout error, keep session alive so user can retry |

---

## Spec File Output Format

The generated spec file follows this template structure:

```markdown
# <Project Name> — Specification

> One-paragraph summary

---

## 1. Project Overview
## 2. Core Requirements
## 3. User Workflows
## 4. Technical Architecture
## 5. Data Model
## 6. API Design
## 7. Authentication & Authorization
## 8. Error Handling
## 9. Testing Plan
## 10. MVP Scope
## 11. Open Questions

---

*Specification generated by Nightfall on <date>.*
```

The development plan file follows:

```markdown
# <Project Name> — Development Plan

> Step-by-step implementation guide derived from the project specification.

---

## Phase Overview
| # | Phase | Depends On | Complexity |
|---|-------|-----------|------------|

## Phase 1 — ...
### Files to Create/Modify
### Implementation Details
### Acceptance Criteria

...

---

*Development plan generated by Nightfall on <date>.*
```

---

## Implementation Order Recommendation

1. Start with Phase 1 + 2 (core side) — get the handler working with a mock provider
2. Then Phase 3 + 4 + 5 (CLI side) — wire up the UI
3. Test end-to-end with a real LLM
4. Phase 6 (natural language trigger) can be added independently
5. Phase 7 (tests) should be written alongside each phase, not batched at the end

Total estimated files: **7 new + 8 modified**.
