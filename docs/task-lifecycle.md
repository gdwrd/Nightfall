# Task Lifecycle

## Overview

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

## Planning

The [Team Lead](agents.md#team-lead) works in two phases. In Phase 1 it reads the memory index and relevant source files to build context. In Phase 2 it produces a typed JSON plan with subtasks, each containing success criteria, constraints, and dependency ordering. You approve (or edit) the plan before any code is written.

## Execution

[Engineers](agents.md#engineer) execute subtasks in dependency-aware waves. Each engineer acquires file locks before writing changes, ensuring no two agents edit the same file simultaneously. Engineers self-check their work by running commands, but these results are informational only.

## Review

The [Reviewer](agents.md#reviewer) independently re-runs all tests and linting with an assume-breach posture. Every issue must cite specific evidence. If the review fails, engineers receive feedback and rework. After `max_rework_cycles` (default: 3), the task is escalated to you.

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

### Initialising the Memory Bank

Run `/init` to scan your project and generate the memory bank. Nightfall reads `package.json`, `tsconfig.json`, `README.md`, `src/` structure, and more. It shows you a preview and asks for confirmation before writing anything.

### How Agents Use Memory

- Every agent loads `index.md` first
- Each agent then pulls only the specific component files relevant to its subtask
- The [Memory Manager](agents.md#memory-manager) updates the bank after every successfully reviewed task

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

### Rolling Back

1. Type `/history` — a browser opens showing all past task runs
2. Select a task to roll back
3. Nightfall shows the **full cascade** — rolling back task N also rolls back all tasks after N
4. Confirm to restore all files to their pre-task state
