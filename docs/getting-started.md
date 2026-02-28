# Getting Started

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 20 | LTS recommended |
| **Ollama** | latest | [ollama.com](https://ollama.com) |
| A pulled model | — | Default: `deepseek-r1:14b` |

Nightfall auto-starts Ollama if it isn't running, and pulls the configured model automatically on first launch.

## Installation

```bash
npm install -g nightfall
```

Then, inside any project you want to work on:

```bash
cd my-project
nightfall
```

## First Run

On first launch Nightfall:

1. Creates `~/.nightfall/config.yaml` with sensible defaults
2. Connects to (or starts) the local Ollama service
3. Pulls the configured model if it isn't present — a progress indicator is shown
4. Drops you into the interactive terminal UI

Run `/init` to set up the memory bank for your project, then start describing tasks in plain English.

## Project Runtime Directories

When you use Nightfall inside a project it creates a `.nightfall/` directory:

```
.nightfall/
├── memory/      # memory bank markdown files
├── logs/        # JSON task run logs (last 50 retained)
├── snapshots/   # pre-task file snapshots
└── .agents/     # optional custom agent prompt overrides
```

Add `.nightfall/` to your `.gitignore` if you don't want to track these files.

## Next Steps

- [Configure Nightfall](configuration.md) — choose a model, adjust concurrency
- [Learn the usage basics](usage.md) — submit tasks, approve plans, use slash commands
- [Understand the agent team](agents.md) — what each agent does and how they collaborate
