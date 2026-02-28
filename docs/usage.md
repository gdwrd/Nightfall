# Usage Guide

## Submitting a Task

Type any coding task in plain English and press **Enter**:

```
> Add input validation to the registration form
> Refactor the database layer to use the repository pattern
> Write unit tests for the auth module
```

## Approving a Plan

After the Team Lead analyses your codebase and produces a subtask plan, you'll see it rendered in the terminal. Respond with:

| Input | Action |
|---|---|
| `y` / `yes` | Approve the plan and begin execution |
| `n` / `no` | Reject — submit a revised task prompt |
| `e` / `edit` | Open the plan JSON in `$EDITOR` for manual edits before approving |

## Cancelling a Running Task

Press **Ctrl+C** while a task is running to cancel immediately. All agent threads are stopped, file locks are released, and in-progress diffs are rolled back.

## Exiting

Press **Ctrl+C** when idle, or type `/exit`.

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

### `/init` — Project Initialization

Run `/init` when you first open a project with Nightfall. It scans your project (reads `package.json`, `tsconfig.json`, `README.md`, `src/` structure, etc.), generates the full [memory bank](task-lifecycle.md#memory-bank), shows you a preview, and asks for confirmation before writing anything.

### `/history` — Browse and Rollback

Type `/history` to open a full-screen browser showing all past task runs. Select any task to view its details, or trigger a rollback. See [Snapshots & Rollback](task-lifecycle.md#snapshot--rollback) for details.

### `/status` — System Status

Shows the active provider, connected model, project root, file lock count, and concurrency settings at a glance.
