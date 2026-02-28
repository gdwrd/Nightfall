# Agent Team

Every task flows through four specialized agents. All agents share the same configured model.

## Team Lead

The Team Lead is responsible for understanding the task and producing an execution plan.

- **Phase 1 — Gather:** reads the memory index and relevant source files; no planning yet
- **Phase 2 — Plan:** breaks the task into the minimum number of subtasks, each with a single responsibility, success criteria, constraints, and dependency ordering
- Outputs a typed JSON plan (`subtasks`, `complexity`, `estimatedEngineers`)

The plan is presented to you for approval before any code is written.

## Engineer

Engineers execute individual subtasks in parallel (up to `max_engineers` concurrent agents).

- Receives exactly one subtask
- Reads relevant memory and source files, acquires file locks, writes minimal diffs
- Self-checks with `run_command` (informational only — the reviewer never trusts these)
- Signals `done` with: `filesChanged`, `testsRun`, `testsPassed`, `confidence`, `concerns`
- Signals `blocked` if the subtask is ambiguous — never guesses

Engineers are dependency-aware: Wave 1 runs all subtasks with no dependencies in parallel, Wave 2 runs subtasks whose Wave 1 deps completed, and so on.

## Reviewer

The Reviewer independently verifies all changes with an assume-breach posture.

- Independently re-runs all tests and linting; never trusts engineer-reported results
- Reads every changed file directly
- Produces an evidence-backed verdict: `passed`, `filesReviewed`, `commandsRun`, `issues[{description, evidence}]`
- Every issue must cite specific evidence (file:line or exact test output), not a general impression

If the review fails, engineers receive the feedback and rework their changes. After `max_rework_cycles` failures, the task is escalated to you.

## Memory Manager

The Memory Manager runs only after a passing review.

- Updates the [memory bank](task-lifecycle.md#memory-bank) with patterns and decisions from the passing implementation
- Never promotes patterns from rejected rework cycles
- Keeps files compact by summarising rather than appending verbatim

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

Partial overrides are supported — only the files present are overridden. Built-in defaults are used for the rest.

Use the `/agents` slash command to see which agents are currently using custom vs built-in prompts.
