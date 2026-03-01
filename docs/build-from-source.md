# Building from Source

This guide explains how to clone, build, and run Nightfall from source code. Follow it if you want to contribute, debug internals, or run a version not yet published to npm.

## Prerequisites

| Dependency | Minimum | Recommended | Notes |
|---|---|---|---|
| **Node.js** | 20.x | 22.x | LTS recommended |
| **npm** | 10.9.4+ | latest | Bundled with Node.js |
| **Git** | any | latest | For cloning the repo |
| **Ollama** | latest | latest | [ollama.com](https://ollama.com) — auto-started on launch |

Verify your environment:

```bash
node --version    # must be >= 20.0.0
npm --version     # must be >= 10.9.4
git --version
```

> **Note:** Nightfall uses no `.nvmrc` or `.node-version` file. Ensure the correct Node.js version is active before proceeding.

## 1. Clone the Repository

```bash
git clone https://github.com/gdwrd/Nightfall.git
cd Nightfall
```

## 2. Install Dependencies

Install all workspace dependencies in one step from the repo root:

```bash
npm install
```

This installs dependencies for all three packages (`shared`, `core`, `cli`) via npm workspaces.

## 3. Build All Packages

```bash
npm run build
```

Turborepo compiles packages in dependency order:

1. **`@nightfall/shared`** — TypeScript types compiled to CommonJS (`packages/shared/dist/`)
2. **`@nightfall/core`** — Engine compiled to CommonJS (`packages/core/dist/`)
3. **`nightfall` (CLI)** — Bundled by esbuild into a single ESM file (`packages/cli/dist/index.js`)

> **Important:** The CLI build uses esbuild (not `tsc`) and resolves `@nightfall/shared` and `@nightfall/core` directly from their TypeScript source files — not from pre-built `dist/` folders. This means a full `npm run build` is only strictly required to produce the final CLI bundle; the CLI's TypeScript compilation (`tsc`) is type-checking only.

## 4. Run the CLI

After a successful build, launch the CLI directly:

```bash
node packages/cli/dist/index.js
```

Or link it globally so the `nightfall` command works anywhere:

```bash
npm link --workspace packages/cli
nightfall
```

On first launch Nightfall will:

1. Create `~/.nightfall/config.yaml` with default settings
2. Connect to (or auto-start) the local Ollama service
3. Pull the configured model if it is not already present
4. Start the WebSocket core server on a free local port
5. Open the interactive terminal UI

Run `/init` inside the UI to set up the memory bank for the project you want to work on.

## 5. Development Workflow (Watch Mode)

For active development, run all packages in watch mode simultaneously:

```bash
npm run dev
```

This starts TypeScript watchers for `shared` and `core` and esbuild in watch mode for the CLI, all in parallel. Changes to any source file recompile the affected package immediately.

## Individual Package Commands

You can also work on a single package at a time:

```bash
# shared
cd packages/shared
npm run build    # compile once
npm run dev      # watch mode

# core
cd packages/core
npm run build    # compile once
npm run dev      # watch mode

# cli
cd packages/cli
npm run build    # bundle once
npm run dev      # watch + re-bundle on changes
```

## Running Tests

```bash
# All packages
npm run test

# Core package only
cd packages/core
npx vitest run

# Single test file
cd packages/core
npx vitest run src/agents/agent.base.test.ts

# CLI package only (if tests exist)
cd packages/cli
npx vitest run
```

> **Note:** The core package's vitest config is named `vitest.config.mts` (`.mts` extension). This is intentional — vitest 4.x uses vite 6.x which is ESM-only, and the `.mts` extension makes Node.js load the config as ESM without requiring `"type":"module"` in `package.json` (which would conflict with the CommonJS output).

## Linting

```bash
npm run lint
```

ESLint runs in flat-config mode across all `**/*.{ts,tsx}` files in every package.

## Configuration

Nightfall is configured via YAML files — no environment variables required.

**Global config** (created automatically on first launch):

```
~/.nightfall/config.yaml
```

**Project config** (optional, overrides global per-project):

```
<your-project>/.nightfall/config.yaml
```

### Default `~/.nightfall/config.yaml`

```yaml
provider:
  name: ollama
  model: deepseek-r1:14b
  host: localhost
  port: 11434

concurrency:
  max_engineers: 3

task:
  max_rework_cycles: 3
  max_retries: 3
  max_context_tokens: 80000

logs:
  retention: 50
```

### Using OpenRouter Instead of Ollama

```yaml
provider:
  name: openrouter
  model: anthropic/claude-sonnet-4-20250514   # or any OpenRouter model
  apiKey: sk-or-...
```

## Runtime Data Directories

When Nightfall runs inside a project it creates a `.nightfall/` directory there:

```
.nightfall/
├── config.yaml     # project-level config (optional)
├── memory/         # memory bank markdown files
├── snapshots/      # pre-task file snapshots for rollback
├── logs/           # JSON task run logs (last 50 retained)
└── .agents/        # optional custom agent prompt overrides
```

Add `.nightfall/` to your `.gitignore` to avoid committing these runtime artifacts.

## Monorepo Structure Reference

```
Nightfall/
├── packages/
│   ├── shared/           # @nightfall/shared — TypeScript types only
│   │   ├── src/
│   │   └── dist/         # CJS output (tsc)
│   ├── core/             # @nightfall/core — WebSocket engine
│   │   ├── src/
│   │   │   ├── agents/       # BaseAgent + LLM loop
│   │   │   ├── orchestrator/ # TaskOrchestrator (lifecycle coordination)
│   │   │   ├── server/       # NightfallServer (WebSocket)
│   │   │   ├── providers/    # Ollama & OpenRouter adapters
│   │   │   ├── tools/        # ToolRegistry (per-role access control)
│   │   │   ├── commands/     # Slash command handlers
│   │   │   ├── memory/       # Memory bank read/write
│   │   │   ├── locks/        # File lock registry + deadlock detection
│   │   │   └── snapshots/    # Pre-task snapshots + rollback
│   │   └── dist/         # CJS output (tsc)
│   └── cli/              # nightfall — terminal UI
│       ├── src/
│       │   ├── components/   # ink/React UI components
│       │   ├── store/        # UI state management
│       │   └── ws.client.ts  # WebSocket client → IOrchestrator bridge
│       ├── dist/         # Single bundled ESM file (esbuild)
│       └── esbuild.config.mjs
├── docs/
├── turbo.json
├── tsconfig.base.json
├── eslint.config.mjs
└── package.json
```

## Module System Notes

| Package | System | Why |
|---|---|---|
| `@nightfall/shared` | CommonJS | Consumed by core at runtime |
| `@nightfall/core` | CommonJS | Node.js server process |
| `nightfall` (CLI) | ESM bundle | `"type":"module"` in package.json; esbuild handles bundling |

The CLI esbuild config uses a workspace resolve plugin that points `@nightfall/shared` and `@nightfall/core` imports directly at their TypeScript sources. External packages (`ink`, `react`, `ws`, `ollama`, `openai`, `js-yaml`, `diff`) are **not** bundled — they are resolved from `node_modules` at runtime.

## Publishing

To publish a new version of the CLI to npm:

```bash
npm run release
```

This runs `turbo build`, `turbo test`, then `npm publish` for `packages/cli`.

## Troubleshooting

**`ERR_REQUIRE_ESM` when running tests in `packages/core`**
Ensure the vitest config file is named `vitest.config.mts` (not `.ts`). The `.mts` extension is required for vitest 4.x / vite 6.x compatibility.

**CLI shows stale output after editing source files**
Re-run `cd packages/cli && npm run build` (or use `npm run dev` for automatic rebuilds).

**`nightfall` command not found after linking**
Run `npm link --workspace packages/cli` from the repo root, or verify `node packages/cli/dist/index.js` works directly.

**Ollama connection refused**
Install Ollama from [ollama.com](https://ollama.com). Nightfall auto-starts it on launch, but the binary must be available in your `PATH`.
