# Nightfall — Implementation Plan

> Developer-ready build plan derived from the full product specification. Phases are ordered by dependency. Each phase lists exact files to create, key implementation details, and acceptance criteria.

---

## Guiding Principles

- Build bottom-up: shared types → core engine → CLI
- Every phase must be independently testable before the next begins
- No phase introduces UI concerns into core, no phase introduces engine concerns into CLI
- Keep `packages/shared` as the single source of truth for all cross-package types

---

## Phase Overview

| # | Phase | Package | Depends On |
|---|---|---|---|
| 1 | Monorepo Scaffold | root | — |
| 2 | Shared Types | `shared` | 1 |
| 3 | Config & Ollama Lifecycle | `core` | 2 |
| 4 | Provider Adapter Layer | `core` | 3 |
| 5 | Memory Bank | `core` | 2, 3 |
| 6 | File Lock Registry | `core` | 2 |
| 7 | Snapshot & Rollback | `core` | 2, 3 |
| 8 | Agent Tool System | `core` | 4, 5, 6, 7 |
| 9 | Agent Prompts | `core` | 8 |
| 10 | Agent Runner | `core` | 4, 8, 9 |
| 11 | Task Orchestrator | `core` | 6, 7, 10 |
| 12 | Task Logger | `core` | 2, 11 |
| 13 | WebSocket Server & Protocol | `core` | 11, 12 |
| 14 | CLI Foundation & Layout | `cli` | 2, 13 |
| 15 | Agent Panel UI | `cli` | 14 |
| 16 | Slash Commands | `cli` | 14, 15 |
| 17 | `/init` Flow | `cli` + `core` | 5, 15, 16 |
| 18 | `/history` & Rollback UI | `cli` + `core` | 7, 15, 16 |
| 19 | Distribution & Global Install | root | all |

---

## Phase 1 — Monorepo Scaffold

**Goal:** Establish the repo structure, tooling, and cross-package build pipeline.

### Files to Create

```
nightfall/
├── package.json                    # Root workspace manifest
├── tsconfig.base.json              # Shared TS compiler options
├── turbo.json                      # Turborepo pipeline config (or nx.json)
├── .eslintrc.js                    # Root ESLint config
├── .prettierrc                     # Prettier config
├── .gitignore
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts            # Barrel export
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
```

### Key Implementation Details

**Root `package.json`:**
```json
{
  "name": "nightfall-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "^5.4",
    "eslint": "^9",
    "@typescript-eslint/parser": "^7",
    "prettier": "^3",
    "vitest": "^1"
  }
}
```

**`tsconfig.base.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**`turbo.json`:**
```json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev":   { "dependsOn": ["^build"], "cache": false, "persistent": true },
    "test":  { "dependsOn": ["^build"] },
    "lint":  {}
  }
}
```

**Per-package `tsconfig.json`** extends base, sets `outDir: "dist"`, `rootDir: "src"`.

**`packages/core/package.json`** — `"main": "dist/index.js"`, `"bin": { "nightfall-core": "dist/index.js" }`.

**`packages/cli/package.json`** — `"bin": { "nightfall": "dist/index.js" }`. Depends on `@nightfall/core` and `@nightfall/shared`.

### Acceptance Criteria
- `npm install` from root installs all workspaces
- `npm run build` compiles all three packages in dependency order
- `packages/shared` exports compile and are importable by `core` and `cli`

---

## Phase 2 — Shared Types

**Goal:** Define all cross-package TypeScript interfaces and enums in `packages/shared` so both `core` and `cli` share a single contract.

### Files to Create

```
packages/shared/src/
├── index.ts
├── agent.types.ts
├── task.types.ts
├── memory.types.ts
├── lock.types.ts
├── snapshot.types.ts
├── config.types.ts
├── websocket.types.ts
└── provider.types.ts
```

### Key Types

**`agent.types.ts`**
```typescript
export type AgentRole = 'team-lead' | 'engineer' | 'reviewer' | 'memory-manager'

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting' | 'done' | 'error'

export interface AgentState {
  id: string                  // e.g. "engineer-1"
  role: AgentRole
  status: AgentStatus
  currentAction: string | null
  log: AgentLogEntry[]
}

export interface AgentLogEntry {
  timestamp: number
  type: 'thought' | 'tool_call' | 'tool_result' | 'message'
  content: string
}
```

**`task.types.ts`**
```typescript
export type TaskStatus = 'planning' | 'awaiting_approval' | 'running' |
                         'reviewing' | 'reworking' | 'completed' |
                         'rework_limit_reached' | 'cancelled'

export interface Subtask {
  id: string
  description: string
  assignedTo: string | null     // agent ID
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  filesTouched: string[]
}

export interface TaskPlan {
  taskId: string
  prompt: string
  subtasks: Subtask[]
  complexity: 'simple' | 'complex'
  estimatedEngineers: number
}

export interface TaskRun {
  id: string
  prompt: string
  plan: TaskPlan | null
  status: TaskStatus
  reworkCycles: number
  agentStates: Record<string, AgentState>
  startedAt: number
  completedAt: number | null
  snapshotId: string | null
}
```

**`memory.types.ts`**
```typescript
export interface MemoryIndex {
  entries: MemoryIndexEntry[]
  components: MemoryComponentEntry[]
}

export interface MemoryIndexEntry {
  file: string
  description: string
}

export interface MemoryComponentEntry {
  file: string         // relative to .nightfall/memory/
  description: string
}
```

**`lock.types.ts`**
```typescript
export interface FileLock {
  path: string
  lockedBy: string
  lockedAt: number
}
```

**`snapshot.types.ts`**
```typescript
export interface SnapshotMeta {
  snapshotId: string
  taskId: string
  prompt: string
  timestamp: number
  parentSnapshotId: string | null
  filesChanged: string[]
}
```

**`config.types.ts`**
```typescript
export interface NightfallConfig {
  provider: {
    name: string
    model: string
    host: string
    port: number
  }
  concurrency: {
    max_engineers: number
  }
  task: {
    max_rework_cycles: number
  }
  logs: {
    retention: number
  }
}
```

**`websocket.types.ts`** — All WS message envelopes (see Phase 13).

**`provider.types.ts`**
```typescript
export interface ProviderAdapter {
  complete(prompt: string, systemPrompt: string): AsyncGenerator<string>
  isAvailable(): Promise<boolean>
  ensureModelReady(model: string): Promise<void>
}
```

### Acceptance Criteria
- All types export cleanly from `packages/shared/src/index.ts`
- No runtime code in `shared` — types only
- `tsc --noEmit` passes with zero errors

---

## Phase 3 — Config & Ollama Lifecycle

**Goal:** Load and validate config from `~/.nightfall/config.yaml`. Manage Ollama service startup, model validation, and auto-pull.

### Files to Create

```
packages/core/src/
├── config/
│   ├── config.loader.ts        # Read + parse + validate ~/.nightfall/config.yaml
│   ├── config.defaults.ts      # Default config values
│   └── config.loader.test.ts
└── ollama/
    ├── ollama.lifecycle.ts     # Detect, start, validate, pull
    └── ollama.lifecycle.test.ts
```

### Key Implementation Details

**`config.loader.ts`**
- Read `~/.nightfall/config.yaml` using `js-yaml`
- Deep-merge with `config.defaults.ts` so missing keys fall back to defaults
- Validate with a lightweight schema check (no heavy dep — plain TS assertions)
- Create `~/.nightfall/` directory if it doesn't exist
- Export `loadConfig(): Promise<NightfallConfig>`

**`config.defaults.ts`**
```typescript
export const DEFAULT_CONFIG: NightfallConfig = {
  provider: { name: 'ollama', model: 'deepseek-r1:14b', host: 'localhost', port: 11434 },
  concurrency: { max_engineers: 3 },
  task: { max_rework_cycles: 3 },
  logs: { retention: 50 },
}
```

**`ollama.lifecycle.ts`**
- `isOllamaRunning(host, port): Promise<boolean>` — `GET http://host:port` with 2s timeout
- `startOllama(): Promise<void>` — `spawn('ollama', ['serve'])`, poll until ready (max 10s)
- `isModelAvailable(model): Promise<boolean>` — `GET /api/tags`, check model name in list
- `pullModel(model, onProgress): Promise<void>` — stream `POST /api/pull`, emit progress events
- `ensureOllama(config, onEvent): Promise<void>` — orchestrates the above four in order; emits structured lifecycle events for the UI to display
- Graceful exit: if any step fails after retries, emit a fatal event with a clear message and `process.exit(1)`

**Lifecycle Event Shape:**
```typescript
type OllamaLifecycleEvent =
  | { type: 'detecting' }
  | { type: 'starting' }
  | { type: 'ready' }
  | { type: 'checking_model'; model: string }
  | { type: 'pulling_model'; model: string; progress: number }
  | { type: 'model_ready'; model: string }
  | { type: 'fatal'; message: string }
```

### Acceptance Criteria
- Config loads with defaults when file is missing
- Config loads user overrides correctly
- `isOllamaRunning` returns `false` when port is closed
- `ensureOllama` emits the correct event sequence in order

---

## Phase 4 — Provider Adapter Layer

**Goal:** Implement the Ollama provider adapter against the `ProviderAdapter` interface. Architecture is ready for future adapters.

### Files to Create

```
packages/core/src/providers/
├── provider.interface.ts       # Re-export from shared (or extend it)
├── ollama/
│   ├── ollama.adapter.ts
│   └── ollama.adapter.test.ts
└── provider.factory.ts         # Returns the correct adapter from config
```

### Key Implementation Details

**`ollama.adapter.ts`**
- Uses the `ollama` npm package
- `complete(prompt, systemPrompt)` — calls `ollama.chat()` with `stream: true`, yields token chunks via `AsyncGenerator<string>`
- `isAvailable()` — delegates to `isOllamaRunning`
- `ensureModelReady(model)` — delegates to Ollama lifecycle functions

**`provider.factory.ts`**
```typescript
export function createProvider(config: NightfallConfig): ProviderAdapter {
  switch (config.provider.name) {
    case 'ollama': return new OllamaAdapter(config)
    default: throw new Error(`Unknown provider: ${config.provider.name}`)
  }
}
```

**Abort support:** `complete()` accepts an optional `AbortSignal` — passed through to the Ollama streaming call so task interruption (Ctrl+C) can abort in-flight requests.

### Acceptance Criteria
- `complete()` streams tokens incrementally (test with a mock server)
- Abort signal cancels the stream mid-way without throwing unhandled errors
- `provider.factory.ts` throws clearly on unknown provider names

---

## Phase 5 — Memory Bank

**Goal:** Implement all memory bank read/write operations used by agents and the `/init` flow.

### Files to Create

```
packages/core/src/memory/
├── memory.manager.ts           # High-level read/write API
├── memory.parser.ts            # Parse index.md into MemoryIndex type
├── memory.writer.ts            # Write/update individual memory files
├── memory.init.ts              # /init logic: scan project, generate initial files
└── memory.manager.test.ts
```

### Key Implementation Details

**`memory.manager.ts`** — primary API used by agents:
```typescript
class MemoryManager {
  constructor(private projectRoot: string) {}

  async loadIndex(): Promise<MemoryIndex>
  async loadFile(relativePath: string): Promise<string>          // e.g. "components/auth.md"
  async updateFile(relativePath: string, content: string): Promise<void>
  async appendToProgress(entry: string): Promise<void>
  async getRelevantFiles(keywords: string[]): Promise<string[]>  // keyword match against index
  async ensureStructure(): Promise<void>                         // create dirs if missing
}
```

**`memory.init.ts`** — `/init` project scan:
- Walk project directory (skip `node_modules`, `.git`, `.nightfall`)
- Identify `package.json`, `tsconfig.json`, entry points, top-level `src/` structure
- Generate `index.md`, `project.md`, `tech.md`, `patterns.md`, `progress.md`
- For each top-level module/directory under `src/`, generate a `components/<name>.md`
- Return a summary diff (list of files created) for user confirmation

**Memory file path resolution:** All paths are relative to `.nightfall/memory/` inside the project root.

**Compactness rule:** `updateFile` never appends raw content — it passes existing content + new content to a helper that trims redundancy. This helper will eventually call the LLM, but in Phase 5 it can be a simple append-then-truncate placeholder.

### Acceptance Criteria
- `loadIndex()` correctly parses a hand-written `index.md`
- `getRelevantFiles(['auth', 'jwt'])` returns `components/auth.md` when index contains it
- `memory.init.ts` creates correct directory structure on a sample project

---

## Phase 6 — File Lock Registry

**Goal:** Implement the in-memory file lock registry with acquire, release, deadlock detection, and status broadcast.

### Files to Create

```
packages/core/src/locks/
├── lock.registry.ts
└── lock.registry.test.ts
```

### Key Implementation Details

**`lock.registry.ts`**
```typescript
class LockRegistry {
  private locks: Map<string, FileLock> = new Map()
  private readonly deadlockTimeoutMs: number   // from config, default 30000

  acquireLock(path: string, agentId: string): Promise<void>
  // Polls every 500ms if locked by another agent. Resolves when lock is acquired.

  releaseLock(path: string, agentId: string): void
  // Removes lock. Throws if agentId doesn't match the holder.

  getLocks(): FileLock[]
  // Returns current snapshot of all active locks — used by WebSocket broadcaster.

  releaseAllLocksFor(agentId: string): void
  // Called on agent cancellation.

  private startDeadlockWatcher(): void
  // setInterval every 5s — auto-release locks older than deadlockTimeoutMs,
  // emit a 'lock_deadlock' event with the affected path and agent.
}
```

- `acquireLock` uses a polling loop with exponential backoff starting at 100ms, capped at 2s
- Emits `EventEmitter` events: `'lock_acquired'`, `'lock_released'`, `'lock_deadlock'` — WebSocket server subscribes to these for live UI updates

### Acceptance Criteria
- Two concurrent `acquireLock` calls for the same path — second waits for first to release
- `releaseAllLocksFor` frees all locks held by an agent
- Deadlock watcher releases a lock held for > threshold and emits the event

---

## Phase 7 — Snapshot & Rollback

**Goal:** Save pre-task file snapshots and implement cascading rollback.

### Files to Create

```
packages/core/src/snapshots/
├── snapshot.manager.ts
└── snapshot.manager.test.ts
```

### Key Implementation Details

**`snapshot.manager.ts`**
```typescript
class SnapshotManager {
  constructor(private projectRoot: string) {}

  async createSnapshot(taskId: string, prompt: string, filePaths: string[]): Promise<string>
  // Copies each file to .nightfall/snapshots/<snapshotId>/files/<path>
  // Writes meta.json with SnapshotMeta shape
  // Returns snapshotId

  async getSnapshot(snapshotId: string): Promise<SnapshotMeta>

  async listSnapshots(): Promise<SnapshotMeta[]>
  // Returns all snapshots sorted by timestamp descending

  async rollback(snapshotId: string): Promise<string[]>
  // Returns list of files restored

  async getRollbackChain(snapshotId: string): Promise<SnapshotMeta[]>
  // Returns [snapshotId, ...all snapshots after it] in reverse order
  // Used to warn user "this will also rollback tasks X, Y, Z"
}
```

**Cascade logic:**
- `listSnapshots()` returns all snapshots
- Any snapshot with `timestamp > target.timestamp` is part of the cascade chain
- `rollbackCascade(snapshotId)` iterates the chain in reverse order, restoring files from each snapshot's `files/` directory, then deletes those snapshot directories

**Snapshot ID format:** `task_${zeroPad(sequenceNum, 3)}_${unixTimestamp}` — e.g. `task_004_1706001234`

### Acceptance Criteria
- Snapshot creates correct directory layout with all files copied
- Rollback restores files to their snapshot state
- `getRollbackChain` correctly identifies all snapshots that would be unwound

---

## Phase 8 — Agent Tool System

**Goal:** Define the tools available to each agent role and implement their execution logic.

### Files to Create

```
packages/core/src/tools/
├── tool.types.ts               # ToolCall, ToolResult interfaces
├── tool.registry.ts            # Maps tool names to implementations
├── tools/
│   ├── read_memory.ts
│   ├── read_file.ts            # Supports full file and range/AST-targeted reads
│   ├── write_diff.ts           # Apply a unified diff to a file
│   ├── run_command.ts          # Execute shell command, return stdout/stderr
│   ├── assign_task.ts          # Team Lead dispatches subtask to engineer
│   ├── request_review.ts       # Team Lead sends work to reviewer
│   ├── write_memory.ts         # Memory Manager updates memory bank
│   └── update_index.ts         # Memory Manager updates index.md
└── tools/*.test.ts
```

### Key Implementation Details

**`tool.types.ts`**
```typescript
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
}

export interface ToolCall {
  tool: string
  parameters: Record<string, unknown>
}

export interface ToolResult {
  tool: string
  success: boolean
  output: string
  error?: string
}
```

**`read_file.ts`** — the most complex tool:
- Accepts `{ path: string, startLine?: number, endLine?: number, symbol?: string }`
- If `symbol` is provided, uses `tree-sitter` to locate the function/class by name and return only that range
- Respects file locks — read-only, so no lock needed, but notes locked files in result
- Returns file contents as string

**`write_diff.ts`**:
- Accepts `{ path: string, diff: string }` where `diff` is unified diff format
- Calls `acquireLock(path, agentId)` before applying
- Applies diff using the `diff` npm package
- Calls `releaseLock(path, agentId)` after success
- On failure, releases lock and returns error result (does NOT rollback — that is Snapshot Manager's job)

**`run_command.ts`**:
- Accepts `{ command: string, cwd?: string, timeoutMs?: number }`
- Runs via `child_process.spawn` with shell
- Default timeout: 30s (configurable per invocation, max 120s)
- Truncates output to 8000 chars — summarizes excess with `[... N bytes truncated]`
- Accepts an `AbortSignal` for task interruption

**`assign_task.ts` / `request_review.ts`**: These are coordination tools — they don't execute I/O directly. They post a structured message to the Task Orchestrator's message bus (see Phase 11).

**`tool.registry.ts`**: Maps agent roles to allowed tool sets:
```typescript
const ROLE_TOOLS: Record<AgentRole, string[]> = {
  'team-lead':      ['read_memory', 'read_file', 'assign_task', 'request_review'],
  'engineer':       ['read_memory', 'read_file', 'write_diff', 'run_command'],
  'reviewer':       ['read_memory', 'read_file', 'run_command'],
  'memory-manager': ['read_file', 'write_memory', 'update_index'],
}
```

### Acceptance Criteria
- `read_file` with `symbol: 'MyClass'` returns only that class's source range
- `write_diff` correctly applies a simple unified diff to a temp file
- `run_command` respects timeout and aborts cleanly
- Calling a tool not in the role's allowed set throws a `ToolNotAllowed` error

---

## Phase 9 — Agent Prompts

**Goal:** Write the default system prompts for all four agent roles and implement the prompt loader that merges custom overrides.

### Files to Create

```
packages/core/src/agents/prompts/
├── prompt.loader.ts            # Loads custom .nightfall/.agents/ overrides
├── team-lead.prompt.ts
├── engineer.prompt.ts
├── reviewer.prompt.ts
└── memory-manager.prompt.ts
```

### Key Implementation Details

**Prompt design principles:**
- Each prompt is a TypeScript template literal, not a static string, so dynamic values (model, max_engineers, etc.) can be injected at runtime
- Prompts emphasize compact, JSON-structured responses to minimize tokens
- Tool use is described in-prompt with exact JSON schemas — no reliance on model-side function calling

**`team-lead.prompt.ts`** — core instructions:
- You are the Team Lead. Analyze the task and the memory bank.
- First response MUST be a JSON plan: `{ subtasks: [...], complexity: 'simple'|'complex', estimatedEngineers: N }`
- After user approval, use `assign_task` to dispatch each subtask
- After review: respond with JSON `{ decision: 'done' | 'rework', reworkInstructions?: Record<subtaskId, string> }`

**`engineer.prompt.ts`** — core instructions:
- You are Engineer `{id}`. Your only task is: `{subtask.description}`
- Use `read_memory` first (index only), then `read_file` for specific files you need
- Use `write_diff` to apply changes — produce the smallest valid unified diff
- Respond with JSON when done: `{ status: 'done', filesChanged: [...], summary: '...' }`

**`reviewer.prompt.ts`** — core instructions:
- You are the Reviewer. Compare the changed files against the original task goal.
- Use `run_command` to execute the project's test/build command
- Respond with JSON: `{ verdict: 'pass' | 'fail', issues?: [{ subtaskId, description }] }`

**`memory-manager.prompt.ts`** — core instructions:
- You are the Memory Manager. Update the memory bank to reflect the completed task.
- Load `index.md`, then each component file relevant to touched files
- Use `write_memory` and `update_index` to persist changes
- Keep all files compact — summarize, never append verbatim logs

**`prompt.loader.ts`**:
```typescript
async function loadPrompt(role: AgentRole, projectRoot: string): Promise<string> {
  const customPath = path.join(projectRoot, '.nightfall', '.agents', `${role}.md`)
  if (await fileExists(customPath)) {
    return fs.readFile(customPath, 'utf-8')
  }
  return getDefaultPrompt(role)
}
```

### Acceptance Criteria
- Custom override file is used when present, default when absent
- Prompts compile without TypeScript errors
- Each prompt includes explicit JSON output schemas for all expected responses

---

## Phase 10 — Agent Runner

**Goal:** Implement the agent execution loop — send prompts, parse tool calls from model output, execute tools, feed results back, repeat until the agent signals completion.

### Files to Create

```
packages/core/src/agents/
├── agent.runner.ts
├── agent.runner.test.ts
└── agent.context.ts            # Per-agent context accumulator
```

### Key Implementation Details

**`agent.context.ts`** — manages the conversation history for a single agent within a single task:
```typescript
class AgentContext {
  private messages: Message[] = []

  addSystem(content: string): void
  addUser(content: string): void
  addAssistant(content: string): void
  addToolResult(tool: string, result: string): void
  getMessages(): Message[]
  reset(): void   // called between tasks — fresh context per task
}
```

**`agent.runner.ts`** — the core ReAct loop:
```typescript
class AgentRunner {
  constructor(
    private role: AgentRole,
    private agentId: string,
    private provider: ProviderAdapter,
    private toolRegistry: ToolRegistry,
    private memoryManager: MemoryManager,
    private onStateChange: (state: AgentState) => void,
    private signal: AbortSignal,
  ) {}

  async run(systemPrompt: string, initialUserMessage: string): Promise<AgentRunResult>
}
```

**Loop logic:**
1. `context.addSystem(systemPrompt)`, `context.addUser(initialUserMessage)`
2. Call `provider.complete()` with all messages, stream tokens
3. Accumulate streamed tokens, emit each chunk via `onStateChange` for live UI
4. When stream ends, attempt to parse JSON from the full response
5. If response contains `tool_calls` key: execute each tool via registry, add results to context, `goto 2`
6. If response contains a `done` signal or no tool calls: return `AgentRunResult`
7. If `AbortSignal` fires at any step: throw `AgentAbortedError`

**`AgentRunResult`:**
```typescript
interface AgentRunResult {
  agentId: string
  role: AgentRole
  finalResponse: string
  toolCallTrace: Array<{ call: ToolCall; result: ToolResult }>
  filesChanged: string[]
  aborted: boolean
}
```

**Max turns guard:** If the loop runs more than 20 turns without a terminal signal, the agent is forced to a `done` state with a warning.

### Acceptance Criteria
- Agent correctly parses and executes a multi-step tool call sequence
- `AbortSignal` cancels the loop mid-stream and returns an aborted result
- `onStateChange` is called with each streamed token chunk
- Max turns guard triggers at 20 and emits a warning in the run result

---

## Phase 11 — Task Orchestrator

**Goal:** Wire all core systems together into the full task lifecycle: plan → approve → snapshot → dispatch → review → decision → memory update.

### Files to Create

```
packages/core/src/orchestrator/
├── task.orchestrator.ts        # Main state machine
├── task.orchestrator.test.ts
└── concurrency.manager.ts      # Controls parallel engineer dispatch
```

### Key Implementation Details

**`task.orchestrator.ts`** — event-driven state machine:

```typescript
type OrchestratorEvent =
  | { type: 'TASK_SUBMITTED'; prompt: string }
  | { type: 'PLAN_APPROVED'; editedPlan?: TaskPlan }
  | { type: 'PLAN_REJECTED' }
  | { type: 'INTERRUPT' }

class TaskOrchestrator extends EventEmitter {
  constructor(
    private config: NightfallConfig,
    private provider: ProviderAdapter,
    private memoryManager: MemoryManager,
    private lockRegistry: LockRegistry,
    private snapshotManager: SnapshotManager,
    private logger: TaskLogger,
  ) {}

  async submitTask(prompt: string): Promise<void>
  async approvePlan(editedPlan?: TaskPlan): Promise<void>
  async rejectPlan(): Promise<void>
  async interrupt(): Promise<void>

  // Events emitted:
  // 'state_change'   — full TaskRun state update (consumed by WS server)
  // 'plan_ready'     — Team Lead produced a plan, waiting for user approval
  // 'task_complete'  — task finished (completed | rework_limit | cancelled)
  // 'agent_update'   — individual agent state changed
}
```

**State machine transitions:**

```
IDLE
  → TASK_SUBMITTED → PLANNING (Team Lead runs)
  → PLANNING → AWAITING_APPROVAL (plan ready event)
  → AWAITING_APPROVAL → RUNNING (plan approved)
  → AWAITING_APPROVAL → IDLE (plan rejected)
  → RUNNING → REVIEWING (all engineers done)
  → REVIEWING → COMPLETE (reviewer passes)
  → REVIEWING → REWORKING (reviewer fails, cycles < max)
  → REWORKING → REVIEWING (rework engineers done)
  → REVIEWING → ESCALATED (cycles >= max)
  → any state → CANCELLED (INTERRUPT received)
```

**`concurrency.manager.ts`**:
- Receives a list of subtasks and `max_engineers` from config
- Dispatches subtasks in batches: first batch fills `max_engineers` slots
- As each engineer finishes, the next pending subtask is dispatched
- Returns `Promise<AgentRunResult[]>` when all subtasks complete

**Interrupt handling:**
- `interrupt()` triggers an `AbortController`
- The abort signal is passed into all running `AgentRunner` instances
- After all runners abort, `releaseAllLocksFor` is called for each aborted agent
- Snapshot is NOT rolled back on interrupt — user must do that manually via `/history`

### Acceptance Criteria
- Full task lifecycle runs end-to-end with mock provider
- Rework loop increments cycle counter, escalates at max
- Interrupt cancels all agents and releases all locks cleanly
- State machine never enters an invalid transition

---

## Phase 12 — Task Logger

**Goal:** Write structured JSON logs for every task run and implement log retention.

### Files to Create

```
packages/core/src/logger/
├── task.logger.ts
└── task.logger.test.ts
```

### Key Implementation Details

**`task.logger.ts`**
```typescript
class TaskLogger {
  constructor(private projectRoot: string, private retention: number) {}

  startLog(taskId: string, prompt: string): void
  recordPlan(taskId: string, plan: TaskPlan): void
  recordAgentAction(taskId: string, agentId: string, entry: AgentLogEntry): void
  recordDiff(taskId: string, path: string, diff: string): void
  recordReviewerReport(taskId: string, report: ReviewerReport): void
  finalizeLog(taskId: string, status: TaskStatus, duration: number): void

  listLogs(): Promise<LogSummary[]>
  getLog(taskId: string): Promise<TaskLog>
  pruneOldLogs(): Promise<void>   // keeps only `retention` most recent
}
```

**Log file naming:** `{ISO8601_timestamp}_{slug}.json` where slug is the first 5 words of the prompt, lowercased and hyphenated. Example: `2024-01-15T14-32-00_add-auth-jwt-middleware.json`

**`pruneOldLogs()`**: Lists all `.json` files in `.nightfall/logs/`, sorts by mtime descending, deletes any beyond `retention` count. Called in `finalizeLog`.

### Acceptance Criteria
- Log file is written with correct shape for a complete task run
- `pruneOldLogs` deletes only excess files when over retention limit
- `listLogs` returns summaries sorted by most recent first

---

## Phase 13 — WebSocket Server & Protocol

**Goal:** Expose the core engine over a local WebSocket so the CLI (and future UIs) can connect, send commands, and receive live state updates.

### Files to Create

```
packages/core/src/server/
├── ws.server.ts                # WebSocket server lifecycle
├── ws.protocol.ts              # All message type definitions
├── ws.broadcaster.ts           # Sends state updates to connected clients
└── core.entrypoint.ts          # Boots config, Ollama, server — main() for core
```

### Message Protocol

**Client → Server (commands):**
```typescript
type ClientMessage =
  | { type: 'SUBMIT_TASK';   payload: { prompt: string } }
  | { type: 'APPROVE_PLAN';  payload: { editedPlan?: TaskPlan } }
  | { type: 'REJECT_PLAN';   payload: {} }
  | { type: 'INTERRUPT';     payload: {} }
  | { type: 'SLASH_COMMAND'; payload: { command: string; args: string } }
```

**Server → Client (updates):**
```typescript
type ServerMessage =
  | { type: 'LIFECYCLE';     payload: OllamaLifecycleEvent }
  | { type: 'TASK_STATE';    payload: TaskRun }
  | { type: 'PLAN_READY';    payload: TaskPlan }
  | { type: 'AGENT_UPDATE';  payload: AgentState }
  | { type: 'LOCK_UPDATE';   payload: FileLock[] }
  | { type: 'TASK_COMPLETE'; payload: { status: TaskStatus; summary: string } }
  | { type: 'SLASH_RESULT';  payload: { command: string; output: string } }
  | { type: 'ERROR';         payload: { message: string } }
```

**`ws.server.ts`**:
- Listens on `localhost:7432` (hardcoded, not exposed externally — local only)
- Accepts exactly one client at a time (CLI); additional connections are rejected with an error message
- On client connect: sends current `TASK_STATE` snapshot immediately
- Parses incoming JSON, dispatches to `TaskOrchestrator` or slash command handler
- All outgoing messages go through `ws.broadcaster.ts`

**`ws.broadcaster.ts`**:
- Subscribes to `TaskOrchestrator` events
- Subscribes to `LockRegistry` events
- Serializes events to `ServerMessage` JSON and sends to the connected client

**`core.entrypoint.ts`** — the `packages/core` main entry:
1. `loadConfig()`
2. `ensureOllama(config, ...)` — emits lifecycle events
3. Build all core services (MemoryManager, LockRegistry, SnapshotManager, Logger)
4. Build `TaskOrchestrator`
5. Start WebSocket server
6. Emit `{ type: 'LIFECYCLE', payload: { type: 'ready' } }` to signal boot complete

### Acceptance Criteria
- CLI can connect, send `SUBMIT_TASK`, and receive streamed `AGENT_UPDATE` messages
- Second client connection is rejected immediately
- Server shuts down cleanly on `SIGINT`/`SIGTERM` (releases locks, finalizes any in-progress log)

---

## Phase 14 — CLI Foundation & Layout

**Goal:** Bootstrap the `packages/cli` ink application, connect to the core WebSocket, and render the base layout.

### Files to Create

```
packages/cli/src/
├── index.ts                    # CLI entrypoint — spawns core, connects WS
├── ws.client.ts                # WebSocket client wrapper
├── store/
│   ├── app.store.ts            # Central state (Zustand or useReducer)
│   └── app.actions.ts          # Actions dispatched from WS messages
├── components/
│   ├── App.tsx                 # Root component
│   ├── Header.tsx              # "🌑 NIGHTFALL   model: ..." bar
│   ├── StatusBar.tsx           # Locked files, current status
│   ├── InputPrompt.tsx         # Bottom input with slash command detection
│   └── theme.ts                # Color constants from spec
└── hooks/
    └── useWebSocket.ts         # Hook that connects to WS and dispatches to store
```

### Key Implementation Details

**`index.ts`** — startup sequence:
1. Find a free port (default 7432, try +1, +2 if taken)
2. `spawn('nightfall-core', ['--port', port])` — forks the core process
3. Wait for `LIFECYCLE ready` message over WS
4. If Ollama events come in before ready, render them in a startup screen
5. Once ready, render the main `<App />` with `render()` from `ink`

**`ws.client.ts`**:
- Wraps `ws` WebSocket
- Reconnects automatically up to 3 times if core crashes
- `send(message: ClientMessage): void`
- `onMessage(handler: (msg: ServerMessage) => void): void`

**`app.store.ts`** — state shape:
```typescript
interface AppState {
  taskRun: TaskRun | null
  plan: TaskPlan | null
  agentStates: Record<string, AgentState>
  locks: FileLock[]
  lifecycleStatus: string
  slashOutput: string | null
  inputValue: string
  mode: 'idle' | 'planning' | 'plan_review' | 'running' | 'done'
}
```

**`theme.ts`**:
```typescript
export const theme = {
  bg: '#0A0A0A',
  primary: '#7C3AED',
  primaryLight: '#6B21A8',
  accent: '#A78BFA',
  text: '#FFFFFF',
  textDim: '#9CA3AF',
  success: '#22C55E',
  error: '#EF4444',
  warning: '#F59E0B',
}
```

**`Header.tsx`**: Single row — "🌑 NIGHTFALL" left-aligned in accent color, `model: {modelName}` right-aligned.

**`InputPrompt.tsx`**:
- Renders `> ` prompt in accent color
- Captures keystrokes via ink's `useInput`
- Detects `/` prefix — enters slash command mode, shows autocomplete hints
- On Enter: dispatches `SUBMIT_TASK` or `SLASH_COMMAND` to WS
- Ctrl+C: dispatches `INTERRUPT` then shows a brief "Cancelling..." message

### Acceptance Criteria
- CLI process starts, spawns core, and renders the header + input within 3 seconds
- Incoming `LIFECYCLE` messages render as startup status lines
- `InputPrompt` captures text and sends `SUBMIT_TASK` on Enter

---

## Phase 15 — Agent Panel UI

**Goal:** Implement the tmux-style agent panel grid that shows live agent state.

### Files to Create

```
packages/cli/src/components/
├── AgentGrid.tsx               # Arranges panels in 2-column layout
├── AgentPanel.tsx              # Single agent panel with streaming log
├── AgentPanelCollapsed.tsx     # Summary line for completed agents
└── PlanReview.tsx              # Shows plan for user approval before running
```

### Key Implementation Details

**`AgentGrid.tsx`**:
- Uses `ink`'s `<Box flexDirection="row" flexWrap="wrap">` for 2-column layout
- Maps over `agentStates` to render `<AgentPanel>` or `<AgentPanelCollapsed>`
- Only shows agents that have been activated in the current task (idle agents are hidden)

**`AgentPanel.tsx`**:
- Header row: agent name + status indicator (`●` active in accent / `○` waiting in dim)
- Body: last N log entries (fit to panel height, calculated from terminal dimensions)
- Live streaming: new log entries appear as `AGENT_UPDATE` messages arrive — ink re-renders each token chunk
- Status colors: thinking → accent, acting → white, done → success, error → error

**`AgentPanelCollapsed.tsx`**:
- Single line: `✅ ENGINEER 1 — Added JWT middleware to auth.ts`
- Uses the `summary` field from `AgentRunResult`

**`PlanReview.tsx`**:
- Renders when `mode === 'plan_review'`
- Displays the plan as a numbered subtask list
- Shows prompt: `Approve plan? [Y]es / [N]o / [E]dit`
- [E]dit opens the plan JSON in `$EDITOR` (like git commit), re-reads on save

### Acceptance Criteria
- Two-column grid renders correctly at 80+ column terminal width
- Falls back to single-column at narrower widths
- Live token streaming in panels doesn't flicker excessively (use ink's `Static` for completed lines)
- Plan review renders all subtasks and accepts Y/N/E input

---

## Phase 16 — Slash Commands

**Goal:** Implement all slash commands listed in the spec, wired to both the CLI input handler and core-side command dispatcher.

### Files to Create

```
packages/core/src/commands/
├── command.dispatcher.ts       # Routes slash commands to handlers
├── handlers/
│   ├── init.handler.ts
│   ├── memory.handler.ts
│   ├── agents.handler.ts
│   ├── config.handler.ts
│   ├── status.handler.ts
│   ├── history.handler.ts
│   ├── clear.handler.ts
│   ├── help.handler.ts
│   └── compact.handler.ts

packages/cli/src/components/
├── SlashOutput.tsx             # Renders SLASH_RESULT payload in a scrollable box
└── SlashAutocomplete.tsx       # Inline hints when typing "/"
```

### Command Implementations

| Command | Handler Logic |
|---|---|
| `/init` | Calls `memory.init.ts` scan, returns summary of files created |
| `/memory` | Runs Memory Manager agent with "review and update memory bank" task |
| `/agents` | Reads `.nightfall/.agents/` for overrides, lists which are custom vs default |
| `/config` | Reads `~/.nightfall/config.yaml`, returns formatted YAML string |
| `/status` | Returns memory index summary + model info + lock count + task count |
| `/history` | Lists last N task logs (id, timestamp, prompt snippet, status) |
| `/clear` | Resets the CLI app state (does not affect memory bank or logs) |
| `/help` | Returns static help text with all command descriptions |
| `/compact` | Summarizes current conversation context to reduce token usage |

**`command.dispatcher.ts`** receives `{ command: string, args: string }` from the WS, routes to the correct handler, returns `{ output: string }`. Output is plain text or markdown — CLI renders it in `SlashOutput`.

**`SlashAutocomplete.tsx`**: When input starts with `/`, render a small hint box above the input showing matching command names + descriptions. Updates on each keystroke.

### Acceptance Criteria
- All 10 slash commands return non-empty output
- `/init` creates `.nightfall/` structure in the current directory
- `/history` output lists tasks in reverse chronological order
- Autocomplete appears and filters correctly while typing

---

## Phase 17 — `/init` Flow

**Goal:** Full end-to-end `/init` user experience — scan, preview, confirm, write.

### Key Implementation Details

This phase completes the `/init` flow that was partially built in Phase 5 (memory.init.ts) and Phase 16 (init.handler.ts):

1. `init.handler.ts` calls `memory.init.ts` scan
2. Returns a preview: list of files to be created with one-line descriptions
3. CLI renders the preview in `SlashOutput`
4. Prompts user: `Create memory bank? [Y]es / [N]o`
5. On Y: handler writes the files, returns success summary
6. On N: returns "Cancelled"

**Smart scanning heuristics in `memory.init.ts`:**
- `package.json` present → Node.js project; read `scripts`, `dependencies`, `devDependencies` for `tech.md`
- `tsconfig.json` present → TypeScript; note in `tech.md`
- `src/` directory → iterate top-level subdirectories to generate component stubs
- `README.md` present → extract first paragraph for `project.md` description
- `.env.example` present → note environment variables in `tech.md`
- `Dockerfile` / `docker-compose.yml` → note in `tech.md`

### Acceptance Criteria
- Running `/init` on this repo (Nightfall itself) produces a meaningful memory bank
- User sees the preview before any files are written
- Cancelling does not write any files

---

## Phase 18 — `/history` & Rollback UI

**Goal:** Browsable history of task runs with in-CLI rollback confirmation flow.

### Files to Create

```
packages/cli/src/components/
├── HistoryView.tsx             # Full-screen history browser (arrow keys to navigate)
└── RollbackConfirm.tsx         # Confirmation dialog showing cascade chain
```

### Key Implementation Details

**`HistoryView.tsx`**:
- Renders when `/history` is called
- Shows a list of past tasks: `[001] 2024-01-15 14:32  add-auth-system  ✅ completed`
- Arrow keys move selection
- Enter on a task: shows detail view (prompt, plan summary, files changed, outcome)
- `R` on a task: enters rollback flow
- `Esc`: returns to main input

**Rollback flow:**
1. CLI sends `SLASH_COMMAND /history rollback <snapshotId>` to core
2. Core calls `snapshotManager.getRollbackChain(snapshotId)`
3. If chain has more than 1 entry, returns warning: "This will also roll back: task_005, task_006"
4. CLI renders `RollbackConfirm` with the chain listed
5. User confirms → core calls `snapshotManager.rollbackCascade(snapshotId)`
6. Returns list of restored files

### Acceptance Criteria
- History shows all logged tasks in correct order
- Rollback cascade correctly identifies all dependent snapshots
- User sees the cascade warning before any files are changed
- After rollback, affected files are restored to their snapshot state

---

## Phase 19 — Distribution & Global Install

**Goal:** Package Nightfall for `npm install -g nightfall` and validate the end-to-end install-and-run flow.

### Files to Create / Modify

```
packages/cli/package.json       # Add "bin", "files", "publishConfig"
packages/core/package.json      # Add "bin" for nightfall-core
root/package.json               # Add "release" script
.npmignore (per package)        # Exclude src/, test files, etc.
```

### Key Implementation Details

**`packages/cli/package.json` additions:**
```json
{
  "name": "nightfall",
  "version": "0.1.0",
  "bin": { "nightfall": "./dist/index.js" },
  "files": ["dist/", "README.md"],
  "dependencies": {
    "@nightfall/core": "*",
    "ink": "^4",
    "react": "^18",
    "ws": "^8"
  }
}
```

**Shebang:** `packages/cli/src/index.ts` must start with `#!/usr/bin/env node`.

**Bundling strategy:**
- `packages/shared` and `packages/core` are bundled into `packages/cli/dist` via `esbuild` to produce a single-file distribution (avoids workspace symlink issues in global installs)
- The bundle is CJS format for broadest Node.js compatibility

**`release` script in root:**
```
turbo run build && npm run test && npm publish --workspace packages/cli
```

**First-run experience:**
- If `~/.nightfall/config.yaml` does not exist, write defaults and print a brief setup message
- If Ollama is not installed, print a clear error: "Ollama is required. Install at https://ollama.ai"

### Acceptance Criteria
- `npm pack` in `packages/cli` produces a valid tarball
- `npm install -g ./nightfall-0.1.0.tgz && nightfall` starts successfully
- Global install includes all bundled dependencies — no missing module errors

---

## Testing Strategy

### Unit Tests (Vitest)
Each core module has a co-located `.test.ts` file. Mock the Ollama provider with a deterministic fake that returns pre-scripted token streams.

### Integration Tests
A test suite in `packages/core/src/__tests__/integration/` runs a full task lifecycle against the mock provider:
- Submit task → get plan → approve → run engineers → review → complete
- Submit task → interrupt mid-run → verify locks released
- Rollback cascade across 3 tasks

### Manual Smoke Tests
Before each release, run the following manually:
1. Cold start (Ollama not running) — verify auto-start and model pull
2. `/init` on a fresh Node.js project
3. Simple single-engineer task (e.g., "add a console.log to index.ts")
4. Complex multi-engineer task (e.g., "add JWT authentication")
5. Task interrupt via Ctrl+C
6. Rollback a task via `/history`

---

## Dependency Install Reference

```bash
# Root
npm install -D turbo typescript vitest eslint prettier @typescript-eslint/parser

# packages/shared  (no runtime deps — types only)

# packages/core
npm install ollama ws js-yaml tree-sitter diff
npm install -D @types/ws @types/js-yaml

# packages/cli
npm install ink react ws
npm install -D @types/react @types/ws esbuild
```

---

## Build Order Summary

```
Phase 1  → Phase 2  → Phase 3  → Phase 4
                   ↘  Phase 5  ↗
                      Phase 6
                      Phase 7
                         ↓
                      Phase 8  → Phase 9  → Phase 10
                                               ↓
                                           Phase 11  → Phase 12  → Phase 13
                                                                       ↓
                                                                   Phase 14  → Phase 15  → Phase 16
                                                                                              ↓
                                                                                   Phase 17, 18, 19
```

---

*Implementation plan ready for developer handoff. Each phase is self-contained and testable before the next begins.*
