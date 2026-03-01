# Architecture

## Monorepo Structure

Nightfall is a TypeScript monorepo managed with [Turborepo](https://turbo.build).

```
nightfall/
├── packages/
│   ├── core/       # engine: agents, orchestration, WebSocket server (@nightfall/core)
│   ├── cli/        # ink terminal UI, connects to core via WebSocket (nightfall)
│   └── shared/     # TypeScript types shared between core and cli (@nightfall/shared)
├── spec/
│   ├── nightfall-spec.md        # full product specification
│   └── implementation-plan.md   # phase-by-phase build plan
├── docs/                        # project documentation
├── eslint.config.mjs
├── tsconfig.base.json
└── turbo.json
```

## System Architecture

```
┌────────────────────────────────────────┐
│            CLI (ink UI)                │
│  renders agent panels, input bar,      │
│  slash commands, history browser       │
└────────────────┬───────────────────────┘
                 │ WebSocket (localhost)
┌────────────────▼───────────────────────┐
│           Core Engine                  │
│  Task Orchestrator                     │
│  Agent Runner + File Lock Registry     │
│  Memory Bank Manager                   │
│  Snapshot + Rollback System            │
│  Provider Adapters (Ollama/OpenRouter) │
│  WebSocket Server                      │
└────────────────────────────────────────┘
```

The core runs as a local WebSocket server; the CLI connects to it as a client. This means a future web UI or VS Code extension can connect to the same engine without any core changes.

## Packages

### `@nightfall/shared`

TypeScript types and interfaces shared between core and CLI. Contains no runtime code — only type definitions for messages, configs, agent protocols, and events.

### `@nightfall/core`

The backend engine containing:

- **Provider adapters** — abstract interface with Ollama and OpenRouter implementations
- **Ollama lifecycle** — auto-start, health checks, model pulling with progress
- **Agent system** — base agent class, tool registry, JSON protocol parser
- **Task orchestrator** — dependency-aware wave scheduling, rework loops, escalation
- **Memory bank** — read/write memory files, `/init` scan and generation
- **File lock registry** — per-file locks with deadlock detection
- **Snapshot system** — pre-task file capture, cascade-aware rollback
- **Command dispatcher** — slash command handlers (9 commands)
- **WebSocket server** — bidirectional communication with the CLI

### `nightfall` (CLI)

The terminal UI built with [ink](https://github.com/vadimdemedes/ink) (React for the terminal):

- **App shell** — fullscreen mode, header with live clock and spinner
- **Agent panel** — per-agent status, streaming thinking output
- **Input bar** — task input with slash command autocomplete
- **History browser** — full-screen task history with rollback confirmation
- **State management** — custom store for UI state

## Development

See **[Build from Source](build-from-source.md)** for a full step-by-step guide. The quick reference is below.

### Setup

```bash
git clone https://github.com/gdwrd/Nightfall.git
cd Nightfall
npm install
npm run build
```

### Commands

```bash
npm run build   # compile all packages in dependency order (via turbo)
npm run dev     # watch mode for all packages in parallel
npm run test    # vitest across all packages
npm run lint    # eslint across all packages
```

### Running a single package

```bash
cd packages/core && npm run build   # compile core only
cd packages/cli  && npm run build   # bundle CLI only
cd packages/core && npx vitest run  # test core only
```

### Publishing

```bash
npm run release # build + test + publish packages/cli to npm
```

### Build dependency order

Turborepo enforces the following order via `"dependsOn": ["^build"]` in `turbo.json`:

1. `@nightfall/shared` — no upstream dependencies
2. `@nightfall/core` — depends on `shared`
3. `nightfall` (CLI) — depends on both; esbuild bundles everything in one pass

### Module systems

| Package | Output | Compiler |
|---|---|---|
| `@nightfall/shared` | CommonJS | `tsc` |
| `@nightfall/core` | CommonJS | `tsc` |
| `nightfall` (CLI) | ESM bundle | `esbuild` |

The CLI esbuild config (`packages/cli/esbuild.config.mjs`) has a workspace resolve plugin that points `@nightfall/shared` and `@nightfall/core` imports at their TypeScript sources directly, so no pre-built `dist/` is required for the CLI build.

### Tech Stack

- **TypeScript** — strict mode across all packages
- **Turborepo** — monorepo build orchestration
- **ink** — React-based terminal UI
- **Vitest** — unit testing (`.mts` config required for vitest 4.x / vite 6.x)
- **ESLint** — flat config (v9) linting
- **esbuild** — production bundling with workspace resolve plugin
- **WebSocket (ws)** — core ↔ CLI communication
