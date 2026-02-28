# AGENTS.md

Guidance for AI coding agents working in the Nightfall repository.

## Project overview

Nightfall is a **local-first multi-agent CLI coding tool** (TypeScript/Node.js monorepo). A Core engine runs as a standalone WebSocket server on port 7171; the CLI is a pure WS client built with ink (React for terminals).

```
CLI (ink/React) ──WebSocket (port 7171)──► Core Engine
```

## Monorepo structure

| Package | Exported name | Build output | Module system |
|---|---|---|---|
| `packages/shared` | `@nightfall/shared` | `tsc` → CJS | CommonJS |
| `packages/core` | `@nightfall/core` | `tsc` → CJS | CommonJS |
| `packages/cli` | `nightfall` | `esbuild` → `dist/index.js` | ESM (`"type":"module"`) |

**Build order (turbo):** `shared` → `core` → `cli`.

The `esbuild.config.mjs` in `packages/cli` bundles `@nightfall/shared` and `@nightfall/core` directly from TypeScript source, so `npm run build` in CLI compiles all three in one pass.

## Dev environment

**Requirements:** Node 20+ (Node 22 also tested in CI), npm.

```bash
npm ci            # install all workspace dependencies
npm run build     # build all packages (turbo, order-aware)
npm run dev       # watch mode — all packages in parallel
```

## Build commands

```bash
npm run build     # full monorepo build
npm run lint      # ESLint across all packages
```

## Testing

```bash
# Run all tests
npm run test

# Run tests for a single package
cd packages/core && npx vitest run
cd packages/cli  && npx vitest run

# Run a single test file
cd packages/core && npx vitest run src/agents/agent.base.test.ts
```

Tests use **vitest**. `packages/core` uses vitest 4.x (vite 6.x, ESM-only) with a `.mts` config file (`vitest.config.mts`) — do **not** rename it to `.ts` or it will fail with `ERR_REQUIRE_ESM`.

## Code style

- **TypeScript strict mode** — `tsconfig.base.json` sets `strict: true`, `module: Node16`, `moduleResolution: Node16`.
- **ESLint flat config** (`eslint.config.mjs` at root) covers `**/*.{ts,tsx}`.
  - `@typescript-eslint/no-unused-vars`: warn (prefix unused args with `_` to suppress)
  - `@typescript-eslint/no-explicit-any`: warn
- **Prettier** is enforced on PRs: `npx prettier --check "packages/*/src/**/*.{ts,tsx,json}"`
- Prefer `const` over `let` wherever the binding is never reassigned.

## Architecture notes

### Core (`packages/core/src/`)

- **`agents/`** — `BaseAgent` drives the LLM loop: call → parse `<tool_call>` → execute → repeat until `<done>`. Streaming throttled to 200 ms previews.
- **`orchestrator/`** — `TaskOrchestrator` lifecycle: Team Lead plans → user approves → Engineers run in parallel waves → Reviewer verifies → rework if needed → Memory Manager captures patterns.
- **`server/`** — `NightfallServer` wraps orchestrator behind WebSocket. Accepts 5 `ClientMessage` types: `SUBMIT_TASK`, `APPROVE_PLAN`, `REJECT_PLAN`, `INTERRUPT`, `SLASH_COMMAND`.
- **`providers/`** — `ProviderAdapter` interface; Ollama and OpenRouter implementations. `provider.factory.ts` selects from config.
- **`tools/`** — `ToolRegistry` enforces per-role access:
  - `team-lead` → read / assign / review
  - `engineer` → read / write_diff / run_command
  - `reviewer` → read / run_command
  - `memory-manager` → read / write_memory / update_index
- **`commands/handlers/`** — slash command handlers: `/init`, `/help`, `/status`, `/history`, `/memory`, `/config`, `/agents`, `/clear`, `/compact`.

### CLI (`packages/cli/src/`)

- **`ws.client.ts`** — `NightfallWsClient` implements `IOrchestrator`; translates WS messages to EventEmitter events.
- **`components/`** — `App.tsx`, `AgentGrid`/`AgentPanel`, `InputBar`, `HistoryView`, `PlanReview`, `ThinkingPanel`.
- **`store/`** — `app.store.ts` + `app.actions.ts` for UI state.

### Agent communication protocol

```
<tool_call>
{"tool": "tool_name", "parameters": {...}}
</tool_call>

<done>
{ ...role-specific JSON result... }
</done>
```

Parsed by `agent.parser.ts` (`parseToolCall`, `parseDone`).

## Runtime data (inside a user's project)

```
.nightfall/
  config.yaml      # model, provider, port, agent overrides
  memory/          # memory bank (managed by memory-manager agent)
  snapshots/       # pre-task snapshots for rollback
  logs/            # JSON task logs
```

Global config: `~/.nightfall/config.yaml`.

## PR and commit conventions

- PRs must pass: **lint**, **typecheck** (`npm run build`), **tests**, and **Prettier check**.
- Branch names follow the pattern `<type>/<short-description>` (e.g. `feat/settings-model-ui`, `fix/ws-reconnect`).
- Commit messages: imperative mood, concise subject line (e.g. `feat: add request routing system`).
- All PRs target `main`.

## Common gotchas

- **`vitest.config.mts`** extension is required in `packages/core` — vitest 4.x / vite 6.x are ESM-only; `.mts` forces ESM loading without adding `"type":"module"` to the package.
- **CLI tsconfig** is for type-checking only — esbuild does the actual bundling and resolves workspace packages from TypeScript source.
- **`packages/cli`** is `"type":"module"` (ESM); `packages/core` and `packages/shared` are CJS — keep imports compatible.
- Unused React props in ink components must be removed or prefixed `_` to avoid lint warnings.
