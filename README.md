# 🌑 Nightfall

> A local-first, multi-agent CLI coding tool powered by Ollama.

A team of specialized AI agents runs entirely on your machine — no cloud, no telemetry, no dependencies outside your local environment. Nightfall orchestrates a **Team Lead**, parallel **Engineers**, a **Reviewer**, and a **Memory Manager** to plan, implement, review, and learn from every coding task you give it.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [First Run](#first-run)
- [Configuration](#configuration)
- [Usage](#usage)
- [Slash Commands](#slash-commands)
- [The Agent Team](#the-agent-team)
- [Task Lifecycle](#task-lifecycle)
- [Memory Bank](#memory-bank)
- [Snapshot & Rollback](#snapshot--rollback)
- [Custom Agent Prompts](#custom-agent-prompts)
- [Project Structure](#project-structure)
- [Development](#development)

---

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 20 | LTS recommended |
| **Ollama** | latest | [ollama.com](https://ollama.com) |
| A pulled model | — | Default: `deepseek-r1:14b` |

Nightfall auto-starts Ollama if it isn't running, and pulls the configured model automatically on first launch.

---

## Installation

```bash
npm install -g nightfall
```

Then, inside any project you want to work on:

```bash
cd my-project
nightfall
```

---

## First Run

On first launch Nightfall:

1. Creates `~/.nightfall/config.yaml` with sensible defaults
2. Connects to (or starts) the local Ollama service
3. Pulls the configured model if it isn't present — a progress indicator is shown
4. Drops you into the interactive terminal UI

Run `/init` to set up the memory bank for your project, then start describing tasks in plain English.

---

## Configuration

Global config lives at **`~/.nightfall/config.yaml`**. It is created automatically on first run.

```yaml
provider:
  name: ollama          # provider adapter — only "ollama" supported today
  model: deepseek-r1:14b
  host: localhost
  port: 11434

concurrency:
  max_engineers: 3      # max parallel engineer agents per task

task:
  max_rework_cycles: 3  # max reviewer rework loops before escalating to you

logs:
  retention: 50         # max task logs kept per project
```

### Changing the model

Edit `~/.nightfall/config.yaml` and set `provider.model` to any model available in your Ollama instance (e.g. `qwen2.5-coder:14b`, `llama3.1:8b`). Nightfall will pull it automatically on the next launch.

```yaml
provider:
  model: qwen2.5-coder:14b
```

---

## Usage

### Submitting a task

Type any coding task in plain English and press **Enter**:

```
> Add input validation to the registration form
> Refactor the database layer to use the repository pattern
> Write unit tests for the auth module
```

### Approving a plan

After the Team Lead analyses your codebase and produces a subtask plan, you'll see it rendered in the terminal. Respond with:

| Input | Action |
|---|---|
| `y` / `yes` | Approve the plan and begin execution |
| `n` / `no` | Reject — submit a revised task prompt |
| `e` / `edit` | Open the plan JSON in `$EDITOR` for manual edits before approving |

### Cancelling a running task

Press **Ctrl+C** while a task is running to cancel immediately. All agent threads are stopped, file locks are released, and in-progress diffs are rolled back.

### Exiting

Press **Ctrl+C** when idle, or type `/exit`.

---

## Slash Commands

| Command | Description |
|---|---|
| `/init` | Scan the project and create the `.nightfall/memory/` bank — shows a preview before writing |
| `/memory` | Trigger the Memory Manager to review and update the memory bank |
| `/status` | Show current model, project root, lock count, and concurrency settings |
| `/history` | Browse past task runs; select one to roll back |
| `/config` | Print the active configuration as JSON |
| `/agents` | Show which agents are using built-in prompts vs custom overrides |
| `/clear` | Clear the message log |
| `/help` | List all slash commands |
| `/compact` | Compress conversation history *(planned)* |
| `/exit` | Quit Nightfall |

---

## The Agent Team

Every task flows through four specialized agents. All agents share the same configured model.

### Team Lead
- **Phase 1 — Gather:** reads the memory index and relevant source files; no planning yet
- **Phase 2 — Plan:** breaks the task into the minimum number of subtasks, each with a single responsibility, success criteria, constraints, and dependency ordering
- Outputs a typed JSON plan (`subtasks`, `complexity`, `estimatedEngineers`)

### Engineer *(runs in parallel, up to `max_engineers`)*
- Receives exactly one subtask
- Reads relevant memory and source files, acquires file locks, writes minimal diffs
- Self-checks with `run_command` (informational only — the reviewer never trusts these)
- Signals `done` with: `filesChanged`, `testsRun`, `testsPassed`, `confidence`, `concerns`
- Signals `blocked` if the subtask is ambiguous — never guesses

### Reviewer
- **Assume-breach posture:** independently re-runs all tests and linting; never trusts engineer-reported results
- Reads every changed file directly
- Produces an evidence-backed verdict: `passed`, `filesReviewed`, `commandsRun`, `issues[{description, evidence}]`
- Every issue must cite specific evidence (file:line or exact test output), not a general impression

### Memory Manager *(runs only on a passing review)*
- Updates the memory bank with patterns and decisions from the passing implementation
- Never promotes patterns from rejected rework cycles
- Keeps files compact by summarising rather than appending verbatim

---

## Task Lifecycle

```
You submit a task
       │
       ▼
[Team Lead — Phase 1: Gather Information]
  Reads memory index → pulls relevant component files
  Reads specific source files — no planning yet
       │
       ▼
[Team Lead — Phase 2: Produce Plan]
  Subtasks with successCriteria, constraints, dependsOn
  Outputs typed JSON plan
       │
       ▼
[You approve the plan]  ←── edit in $EDITOR if needed
       │
       ▼
[Snapshot] — pre-task file state saved to .nightfall/snapshots/
       │
       ▼
[Engineer Agents — Dependency-Aware Scheduling]
  Wave 1: all subtasks with no dependencies run in parallel
  Wave 2: subtasks whose Wave 1 deps completed — and so on
  Each engineer acquires file locks, writes diffs, self-checks
       │
       ▼
[Reviewer — Assume-Breach]
  Independently re-runs all tests & linting
  Evidence-backed verdict
       │
       ▼
  ✅ Passed → Memory Manager updates bank → task complete
  ❌ Failed → Engineers rework with reviewer feedback
              After max_rework_cycles → escalated to you
```

---

## Memory Bank

The memory bank is a set of compact markdown files that give agents long-term context without burning tokens. It lives at `.nightfall/memory/` inside your project.

```
.nightfall/memory/
├── index.md          # map of every component file — loaded by all agents every time
├── project.md        # project goals, scope, requirements
├── tech.md           # stack, dependencies, dev setup
├── patterns.md       # architecture decisions, key design patterns
├── progress.md       # what works, what's left, known issues
└── components/       # auto-generated component-specific files
    ├── auth.md
    ├── db.md
    └── api.md
```

### Initialising the memory bank

```
/init
```

Nightfall scans your project (reads `package.json`, `tsconfig.json`, `README.md`, `src/` structure, etc.), generates the full memory bank, shows you a preview, and asks for confirmation before writing anything.

### How agents use memory

- Every agent loads `index.md` first
- Each agent then pulls only the specific component files relevant to its subtask
- The Memory Manager updates the bank after every successfully reviewed task

---

## Snapshot & Rollback

Before execution begins on any approved plan, Nightfall saves the current state of every file that will be touched:

```
.nightfall/snapshots/
├── task_001_1706000000/
│   ├── meta.json     # prompt, timestamp, parent task ID, files changed
│   └── files/        # copy of every file before the task ran
└── task_002_1706001000/
    └── ...
```

### Rolling back via `/history`

1. Type `/history` — a browser opens showing all past task runs
2. Select a task to roll back
3. Nightfall shows the **full cascade** — rolling back task N also rolls back all tasks after N
4. Confirm to restore all files to their pre-task state

---

## Custom Agent Prompts

Override any agent's system prompt by placing a markdown file in `.nightfall/.agents/`:

```
.nightfall/
└── .agents/
    ├── team-lead.md        # overrides Team Lead prompt
    ├── engineer.md         # overrides Engineer prompt
    ├── reviewer.md         # overrides Reviewer prompt
    └── memory-manager.md   # overrides Memory Manager prompt
```

Partial overrides are supported — only the files present are overridden. Built-in defaults are used for the rest. Use `/agents` to see which agents are currently using custom vs built-in prompts.

---

## Project Structure

This is a TypeScript monorepo managed with Turborepo.

```
nightfall/
├── packages/
│   ├── core/       # engine: agents, orchestration, WebSocket server (@nightfall/core)
│   ├── cli/        # ink terminal UI, connects to core via WebSocket (nightfall)
│   └── shared/     # TypeScript types shared between core and cli (@nightfall/shared)
├── spec/
│   ├── nightfall-spec.md        # full product specification
│   └── implementation-plan.md   # phase-by-phase build plan
├── eslint.config.mjs
├── tsconfig.base.json
└── turbo.json
```

### Architecture

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
│  Ollama Provider Adapter               │
│  WebSocket Server                      │
└────────────────────────────────────────┘
```

The core runs as a local WebSocket server; the CLI connects to it as a client. This means a future web UI or VS Code extension can connect to the same engine without any core changes.

---

## Development

### Setup

```bash
git clone https://github.com/gdwrd/Nightfall.git
cd Nightfall
npm install
```

### Commands

```bash
npm run build   # compile all packages (via turbo)
npm run lint    # eslint across all packages
npm run test    # vitest across all packages
npm run dev     # watch mode for all packages
```

### Publishing

```bash
npm run release # build + test + publish packages/cli to npm
```

### Per-project runtime directories

Created automatically when you use Nightfall inside a project:

```
.nightfall/
├── memory/      # memory bank markdown files
├── logs/        # JSON task run logs (last 50 retained)
├── snapshots/   # pre-task file snapshots
└── .agents/     # optional custom agent prompt overrides
```

---

## Roadmap

- Web UI (same WebSocket engine, React frontend)
- VS Code extension
- Per-agent model assignment
- Additional providers: OpenAI, Anthropic, LM Studio
- `/compact` conversation compression
- Shared team memory bank (multi-developer support)
- Plugin system for custom tools

---

*Built with [Ollama](https://ollama.com) · [ink](https://github.com/vadimdemedes/ink) · [Turborepo](https://turbo.build)*
