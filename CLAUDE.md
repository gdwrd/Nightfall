# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build all packages (order-aware via turbo)
npm run build

# Run all tests
npm run test

# Lint all packages
npm run lint

# Watch mode (all packages in parallel)
npm run dev

# Run tests for a single package
cd packages/core && npx vitest run
cd packages/cli  && npx vitest run

# Run a single test file in core
cd packages/core && npx vitest run src/agents/agent.base.test.ts

# Publish CLI to npm (build + test + publish)
npm run release
```

## Architecture

Nightfall is a **local-first multi-agent coding tool** with a strict separation between the backend engine and the terminal UI.

```
CLI (ink/React) ──WebSocket (port 7171)──► Core Engine
```

The core runs as a standalone WebSocket server; the CLI is a pure WS client. This means any future UI (web, VS Code) connects to the same engine unchanged.

### Packages

| Package | Name | Build | Module system |
|---|---|---|---|
| `packages/shared` | `@nightfall/shared` | `tsc` → CJS | CommonJS |
| `packages/core` | `@nightfall/core` | `tsc` → CJS | CommonJS |
| `packages/cli` | `nightfall` | `esbuild` → single `dist/index.js` | ESM (`"type":"module"`) |

**Turbo build order:** `shared` → `core` → `cli`. The `esbuild.config.mjs` in `packages/cli` has a workspace resolve plugin that points `@nightfall/shared` and `@nightfall/core` directly at their TypeScript source files, so it bundles everything in one pass.

### Core internals (`packages/core/src/`)

- **`agents/`** — `BaseAgent` class drives the LLM loop (call → parse tool call → execute → repeat until `<done>`). All four agent roles are instances of `BaseAgent` with different configs. Streaming responses are throttled to emit live previews every 200 ms.
- **`orchestrator/`** — `TaskOrchestrator` coordinates the full lifecycle: Team Lead plans → user approves → Engineers run in parallel waves → Reviewer verifies → rework loop if needed → Memory Manager captures patterns. Emits typed events consumed by the WS server.
- **`server/`** — `NightfallServer` wraps the orchestrator behind a WebSocket interface. Handles 5 `ClientMessage` types: `SUBMIT_TASK`, `APPROVE_PLAN`, `REJECT_PLAN`, `INTERRUPT`, `SLASH_COMMAND`.
- **`providers/`** — `ProviderAdapter` interface with Ollama and OpenRouter implementations. `provider.factory.ts` selects the adapter from config.
- **`tools/`** — `ToolRegistry` enforces per-role tool access. Role permissions: `team-lead` → read/assign/review, `engineer` → read/write_diff/run_command, `reviewer` → read/run_command, `memory-manager` → read/write_memory/update_index.
- **`commands/handlers/`** — 9 slash command handlers (`/init`, `/help`, `/status`, `/history`, `/memory`, `/config`, `/agents`, `/clear`, `/compact`).
- **`locks/`**, **`snapshots/`**, **`memory/`** — file lock registry (deadlock detection), pre-task snapshots with cascade-aware rollback, memory bank R/W.

### CLI internals (`packages/cli/src/`)

- **`ws.client.ts`** — `NightfallWsClient` implements `IOrchestrator`, translating WS messages to EventEmitter events. `App.tsx` and slash commands depend only on the `IOrchestrator` interface, not the concrete client.
- **`components/`** — ink (React for terminal) UI: `App.tsx` (root), `AgentGrid`/`AgentPanel` (live agent status), `InputBar` (task input + autocomplete), `HistoryView` (task history + rollback), `PlanReview` (approve/edit/reject plans), `ThinkingPanel` (fullscreen streaming output).
- **`store/`** — `app.store.ts` + `app.actions.ts` for UI state management.

### Agent communication protocol

Agents signal tool calls and completion via XML-like blocks in their LLM output:

```
<tool_call>
{"tool": "tool_name", "parameters": {...}}
</tool_call>

<done>
{ ...role-specific JSON result... }
</done>
```

The `agent.parser.ts` functions `parseToolCall` and `parseDone` extract these from raw response text.

## TypeScript configuration

- `tsconfig.base.json`: `module: Node16`, `moduleResolution: Node16`, `strict: true`
- `packages/core` and `packages/shared` extend base — emit CJS
- `packages/cli` has `"type": "module"` but is bundled by esbuild (the tsconfig is only for type-checking)
- `packages/core/vitest.config.mts` uses `.mts` extension — required because vitest 4.x (vite 6.x) is ESM-only and the package lacks `"type":"module"`

## ESLint

Flat config in `eslint.config.mjs` at root. Covers `**/*.{ts,tsx}`. Key rules:
- `@typescript-eslint/no-unused-vars`: warn (args prefixed `_` are exempt)
- `@typescript-eslint/no-explicit-any`: warn

## Runtime data locations (inside the user's project)

```
.nightfall/
  config.yaml      # user config (model, provider, port, agent overrides)
  memory/          # memory bank files managed by memory-manager agent
  snapshots/       # pre-task file snapshots for rollback
  logs/            # task run logs (JSON)
```

Global config at `~/.nightfall/config.yaml` on first launch.
