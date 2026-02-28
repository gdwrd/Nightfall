# Nightfall — Full Product Specification

> A local-first, multi-agent CLI coding tool powered by Ollama. A team of AI agents operates entirely on your machine — no cloud, no telemetry, no dependencies outside your local environment.

---

## 1. Overview

Nightfall is a TypeScript/Node.js CLI tool that orchestrates a team of specialized AI agents to handle coding tasks. It is inspired by Claude Code and Gemini CLI but is purpose-built for local Ollama models and multi-agent parallel execution. The core engine is UI-agnostic, exposing a WebSocket API that the CLI consumes — allowing a future web UI or VS Code extension to plug in without any engine changes.

**Invoke:** `nightfall` (after `npm install -g nightfall`)

---

## 2. Core Philosophy

- **Local only** — Ollama is the only supported provider at launch; architecture is provider-agnostic for future expansion
- **Token efficiency** — every system decision optimizes for minimal context window usage
- **Memory by default** — all agents operate from a structured memory bank; no agent starts blind
- **Team by default** — every task goes through the full agent pipeline; the Team Lead decides complexity routing
- **Plan before code** — every task begins in plan mode; no code is written without user approval

---

## 3. Architecture

### 3.1 Two-Layer Architecture

```
┌─────────────────────────────────────────┐
│              UI Layer                   │
│   nightfall-cli (ink / terminal UI)     │
│   nightfall-web (future React web UI)   │
└────────────────┬────────────────────────┘
                 │ WebSocket (local)
┌────────────────▼────────────────────────┐
│             Core Engine                 │
│  Agent Orchestrator                     │
│  Task Runner + Concurrency Manager      │
│  File Lock Registry                     │
│  Memory Bank Manager                    │
│  Snapshot + Rollback System             │
│  Provider Adapter Layer                 │
│  WebSocket Server                       │
└─────────────────────────────────────────┘
```

### 3.2 Monorepo Package Structure

```
nightfall/
├── packages/
│   ├── core/          # Engine, agents, orchestration, WebSocket server
│   ├── cli/           # ink terminal UI, connects to core via WebSocket
│   └── shared/        # Shared TypeScript types and interfaces
├── nightfall.config.yaml   # Global config (user home dir: ~/.nightfall/)
└── .nightfall/             # Per-project directory (created on /init)
    ├── memory/             # Memory bank files
    ├── logs/               # Task run logs
    ├── snapshots/          # Pre-task file snapshots
    └── .agents/            # Optional custom agent prompts
```

---

## 4. Configuration

### 4.1 Global Config — `~/.nightfall/config.yaml`

```yaml
provider:
  name: ollama               # Adapter name — swap for "openai", "anthropic" etc. in future
  model: deepseek-r1:14b     # Model used by all agents
  host: localhost
  port: 11434

concurrency:
  max_engineers: 3           # Max parallel engineer agents

task:
  max_rework_cycles: 3       # Max reviewer rework loops before escalating to user

logs:
  retention: 50              # Max task run logs to keep per project
```

### 4.2 Provider Adapter Interface

All providers implement a common interface so swapping providers requires only a config change:

```typescript
interface ProviderAdapter {
  complete(prompt: string, systemPrompt: string): AsyncGenerator<string>
  isAvailable(): Promise<boolean>
  ensureModelReady(model: string): Promise<void>
}
```

---

## 5. Ollama Lifecycle Management

On every launch, Nightfall automatically:

1. **Detects** if Ollama is running (`GET http://localhost:11434`)
2. **Starts** the Ollama service if it is not running
3. **Validates** the configured model is pulled and available
4. **Pulls** the model automatically if it is not found (`ollama pull <model>`), with a progress indicator in the UI
5. **Warns** clearly if any step fails and exits gracefully

---

## 6. Agent Team

### 6.1 Default Agent Roster

| Agent | Role | Tool Access |
|---|---|---|
| **Team Lead** | Gathers codebase context (Phase 1), then produces a typed subtask plan with success criteria, constraints, and dependency ordering (Phase 2) | `read_memory`, `read_file`, `assign_task`, `request_review` |
| **Engineer** | Implements exactly one assigned subtask; signals blocked if the subtask is ambiguous rather than guessing; emits a typed done signal with files changed, test results, and confidence level | `read_memory`, `read_file`, `write_diff`, `run_command` |
| **Reviewer** | Independently re-runs all tests and linting (assume-breach posture — never trusts engineer-reported results); emits an evidence-backed verdict with per-issue file/line citations | `read_memory`, `read_file`, `run_command` |
| **Memory Manager** | Updates memory bank only from work the Reviewer explicitly passed; guards against promoting rejected patterns from failed rework cycles | `read_file`, `write_memory`, `update_index` |

### 6.2 Custom Agent Prompts

Users can override any agent's system prompt by placing files in `.nightfall/.agents/`:

```
.nightfall/
└── .agents/
    ├── team-lead.md
    ├── engineer.md
    ├── reviewer.md
    └── memory-manager.md
```

If a file is present, Nightfall uses it. If not, the built-in default prompt is used. Partial overrides are supported — override only the agents you want.

### 6.3 Model Assignment

At launch, one model is configured globally. All agents use the same model. Per-agent model assignment is a future enhancement.

### 6.4 Agent Communication Protocol

Agents communicate through typed JSON done signals rather than free-text summaries. The `<done>` block in every agent response must contain valid JSON matching the role's schema. The orchestrator parses each schema with role-specific logic — no double-encoding.

**Team Lead done signal:**
```json
{
  "subtasks": [
    {
      "id": "subtask-1",
      "description": "Full implementation instructions",
      "files": ["src/foo.ts"],
      "successCriteria": ["tests pass for X", "function Y returns Z"],
      "constraints": ["do not modify files outside listed scope"],
      "dependsOn": []
    }
  ],
  "complexity": "simple | complex",
  "estimatedEngineers": 2
}
```
`dependsOn` is an array of subtask IDs that must reach `done` before this subtask can start (empty = can run in parallel). `successCriteria` and `constraints` are embedded into the engineer's task description by the orchestrator.

**Engineer done signal:**
```json
{
  "filesChanged": ["src/foo.ts"],
  "testsRun": ["npm test -- --testPathPattern=foo"],
  "testsPassed": true,
  "confidence": "high | medium | low | blocked",
  "concerns": ["optional notes about edge cases or risks"]
}
```
`confidence: "blocked"` means the engineer could not start because the subtask was ambiguous or referenced missing files. The orchestrator treats a blocked or interrupted engineer as a failed subtask — it does not proceed to review.

**Reviewer done signal:**
```json
{
  "passed": true,
  "filesReviewed": ["src/foo.ts"],
  "commandsRun": ["npm test", "npm run lint"],
  "issues": [
    { "description": "what is wrong", "evidence": "exact test output line or file:lineNumber" }
  ],
  "notes": "overall summary of what was verified"
}
```
`issues` must be an empty array `[]` when `passed` is `true`. Every issue must cite specific evidence — not a general impression.

**Memory Manager done signal:**
```json
{ "summary": "brief description of what memory was updated" }
```

---

## 7. Task Lifecycle

### 7.1 Full Flow

```
User submits task
       │
       ▼
[Team Lead — Phase 1: Gather Information]
  Reads memory index → pulls all relevant component files
  Reads specific source files (read_file) — no planning yet
       │
       ▼
[Team Lead — Phase 2: Produce Plan]
  Breaks task into minimum subtasks, each with ONE job
  Populates successCriteria, constraints, and dependsOn per subtask
  Outputs typed JSON plan (subtasks + complexity + estimatedEngineers)
       │
       ▼
[User approves plan] ◄──── User can edit plan before approving
       │
       ▼
[Snapshot] — pre-task file states saved to .nightfall/snapshots/
       │
       ▼
[Engineer Agents — Dependency-Aware Scheduling]
  Orchestrator schedules subtasks in topological waves:
    Wave 1: all subtasks with empty dependsOn run in parallel (up to max_engineers)
    Wave 2: subtasks whose dependencies completed in wave 1, and so on
  Each engineer:
    Reads memory bank (index → relevant files only)
    Reads specific source files as needed
    Acquires file locks before editing, releases after
    Writes changes as diffs only
    Self-checks with run_command (informational only)
    Signals done with typed JSON: filesChanged, testsPassed, confidence, concerns
  Blocked engineer (confidence: "blocked") → subtask marked failed, reviewer sees it
  Interrupted engineer (hit maxIterations) → subtask marked failed
       │
       ▼
[Reviewer Agent — Assume-Breach Posture]
  Receives structured engineer done signals (not prose)
  Independently re-runs ALL tests and linting — never trusts engineer reports
  Reads every changed file directly
  Produces evidence-backed verdict: passed + filesReviewed + commandsRun + issues[{description,evidence}]
       │
       ▼
[Decision]
  ✅ Passed → Memory Manager updates memory bank → task complete
  ❌ Failed → Rework: each engineer receives its own previous attempt summary
               + full reviewer issues list → engineers retry
  After max_rework_cycles failures → escalate to user with full reviewer report
       │
       ▼
[Memory Manager] (only on pass)
  Receives: task prompt + engineer results + reviewer verdict (PASSED)
  Promotes only patterns from the final passing implementation
  Never persists patterns from rejected rework cycles
  Updates progress.md, patterns.md, relevant component files
```

### 7.2 Task Interruption (Ctrl+C)

- All running engineer agents are cancelled immediately
- Ollama requests are aborted
- File locks are released
- In-progress diffs are rolled back
- Task is marked as `cancelled` in logs
- User is returned to the input prompt

---

## 8. File Lock Registry

A central in-memory registry tracks file lock state for all concurrent agents:

```typescript
interface FileLock {
  path: string
  lockedBy: string      // agent ID
  lockedAt: number      // timestamp
}
```

- Before editing any file, an engineer calls `acquireLock(path)`
- If the file is locked, the engineer waits and retries (with configurable backoff)
- After writing the diff, the engineer calls `releaseLock(path)`
- The CLI displays currently locked files in the agent panel UI
- Deadlock detection: if a lock is held for more than N seconds without activity, it is auto-released and the agent is flagged

---

## 9. Token Compression Strategy

Nightfall applies multiple layers of token optimization:

| Strategy | Description |
|---|---|
| **Memory routing** | Agents load the index first, then pull only the specific component files relevant to their subtask |
| **AST-aware file reading** | `read_file` can target specific functions, classes, or line ranges — not always the whole file |
| **Diff-based writes** | Engineers never rewrite whole files; they produce and apply minimal diffs |
| **Typed done signals** | Each agent role emits a specific JSON schema in its done block; the orchestrator parses each schema directly — no free-text summaries, no double-encoding |
| **Context isolation per agent** | Each agent receives only the data it needs: engineers get their subtask description only; the reviewer gets structured engineer done signals, not raw conversation history |
| **Per-task context reset** | Each agent's context window is fresh per task — no accumulating chat history |
| **Summary handoff** | Team Lead summarizes engineer outputs before passing to Reviewer |

---

## 10. Memory Bank

### 10.1 Structure

```
.nightfall/memory/
├── index.md           # Map file — short description of every component file
├── project.md         # Project brief, goals, scope
├── tech.md            # Tech stack, dependencies, dev setup
├── patterns.md        # Architecture decisions, design patterns
├── progress.md        # What works, what's left, known issues
└── components/        # Component-specific files (auto-generated)
    ├── db.md
    ├── auth.md
    ├── api.md
    └── ...
```

### 10.2 Index File Format (`index.md`)

The index is the only file all agents load every time. It must be as compact as possible:

```markdown
# Memory Index
- project.md — project goals, scope, requirements
- tech.md — stack, deps, environment setup
- patterns.md — architecture, key decisions, design patterns
- progress.md — current status, known issues
## Components
- components/db.md — database schema, ORM setup, migration patterns
- components/auth.md — authentication flow, JWT config, session handling
- components/api.md — REST endpoints, request/response contracts
```

### 10.3 Memory Manager Responsibilities

The Memory Manager agent runs after every completed task:

1. Reads all files touched during the task
2. Determines which memory bank files need updating
3. Updates relevant component files with new patterns, decisions, or context
4. Updates `progress.md` with task outcome
5. Updates `index.md` if new component files were created
6. Keeps all files as compact as possible — summarizes rather than appends verbatim

The Memory Manager can also be triggered manually via the `/memory` slash command.

---

## 11. Snapshot & Rollback System

### 11.1 Pre-task Snapshots

Before every task begins (after plan approval), Nightfall saves:

- A snapshot of every file in the working directory that may be touched
- The original task prompt
- A reference to the parent task snapshot (forming a chain)

```
.nightfall/snapshots/
├── task_001_1706000000/
│   ├── meta.json         # prompt, timestamp, parent_task_id, files_changed
│   └── files/            # copy of pre-task state of each modified file
├── task_002_1706001000/
│   └── ...
```

### 11.2 Rollback Behavior

- Rolling back task N automatically rolls back all tasks after N first (cascade), unwinding the stack in reverse order
- Each rollback restores files from the snapshot to their pre-task state
- Rollback is confirmed with the user before executing ("This will also rollback tasks 3, 4, and 5 — continue?")
- After rollback, the user can edit the original prompt and resubmit via `/history`

---

## 12. CLI UI

### 12.1 Visual Identity

- **Color palette:** Deep purple (`#6B21A8`, `#7C3AED`) on black (`#0A0A0A`)
- **Accent:** Bright violet (`#A78BFA`) for active states, white for text
- **Style:** Matches Claude Code's clean terminal aesthetic — functional, not flashy
- **Framework:** `ink` (React for CLIs) + `yoga-layout`

### 12.2 Agent Panel Layout

Each agent gets its own live panel (tmux-style split layout):

```
┌─────────────────────────────────────────────────────────┐
│ 🌑 NIGHTFALL                              model: qwen2.5 │
├──────────────────────────┬──────────────────────────────┤
│ TEAM LEAD          ●     │ ENGINEER 1         ●         │
│ Planning subtasks...     │ Reading auth.ts...           │
│ > Breaking into 3 parts  │ > Acquiring lock on auth.ts  │
│                          │ > Writing diff...            │
├──────────────────────────┼──────────────────────────────┤
│ ENGINEER 2         ●     │ REVIEWER           ○ waiting │
│ Running npm test...      │                              │
│ > Tests passed ✓         │                              │
├──────────────────────────┴──────────────────────────────┤
│ 🔒 Locked: src/auth.ts (Engineer 1)                     │
├─────────────────────────────────────────────────────────┤
│ > _                                                     │
└─────────────────────────────────────────────────────────┘
```

- Active agents show a live streaming thought/action log
- Completed agent panels collapse to a single summary line with ✅
- Locked files displayed in a status bar
- Input prompt always visible at the bottom

### 12.3 Slash Commands

Nightfall matches Claude Code's slash command system plus multi-agent extensions:

| Command | Description |
|---|---|
| `/init` | Initialize memory bank for current project |
| `/plan` | Show Team Lead's plan for the current task before submission |
| `/memory` | Trigger Memory Manager to review and update memory bank |
| `/agents` | Show currently loaded agent configs (custom or default) |
| `/config` | View and edit current configuration |
| `/status` | Show memory bank state, model info, concurrency settings |
| `/history` | List past task runs — browse, rollback, or resubmit |
| `/clear` | Clear current conversation context |
| `/help` | Show all available commands |
| `/compact` | Compress conversation history to save context |

---

## 13. Task Logging

Every task run produces a structured JSON log:

```
.nightfall/logs/
└── 2024-01-15T14-32-00_add-auth-system.json
```

Log contents:
- Original prompt
- Plan produced by Team Lead
- Each agent's full action trace (tool calls, reasoning, outputs)
- All diffs applied
- Files changed
- Reviewer reports (all cycles)
- Final outcome (`completed` | `rework_limit_reached` | `cancelled`)
- Timestamp and duration

Log retention: last 50 task runs per project (configurable). Older logs are auto-purged.

---

## 14. Git Integration

Nightfall is **non-invasive to git by default.** It never touches git unless the user explicitly requests it.

Supported on-demand git operations (triggered by natural language in the task prompt or as a follow-up command):

- Commit with an auto-generated commit message
- No auto-branching, no auto-push

---

## 15. Language & Runtime Support

Nightfall supports all programming languages and project types. Engineers can run any shell command via `run_command`, so language-specific tooling (build, test, lint) is handled natively by whatever the project uses.

The memory bank component files are language-agnostic markdown — agents describe patterns and decisions in plain language regardless of the stack.

---

## 16. Project Initialization — `/init` Flow

When a user runs `/init` inside the Nightfall UI for the first time in a project:

1. Memory Manager scans the project directory structure
2. Identifies key components, entry points, config files, and dependencies
3. Generates the full memory bank structure (index + component files)
4. Presents a summary of what was created and asks the user to confirm or edit
5. Creates `.nightfall/` directory with memory, logs, and snapshots folders
6. Writes initial `project.md` with inferred project description (user can edit)

---

## 17. Technical Stack

| Concern | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Terminal UI | `ink` + React |
| WebSocket | `ws` library |
| Diff application | `diff` / `patch` utilities |
| AST parsing | `tree-sitter` (multi-language) |
| Config files | YAML (`js-yaml`) |
| Distribution | npm global install |
| Ollama client | `ollama` npm package |
| Concurrency | Node.js async + worker coordination |

---

## 18. Future Roadmap (Out of Scope for V1)

- Web UI consuming the same WebSocket engine
- VS Code extension
- Per-agent model assignment
- Additional provider adapters (OpenAI, Anthropic, LM Studio)
- Shared team memory bank (multi-developer support)
- Plugin system for custom tools

---

*Specification compiled from iterative design sessions. Ready for developer handoff.*
