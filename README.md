# Nightfall

> A local-first, multi-agent CLI coding tool powered by Ollama.

A team of specialized AI agents runs entirely on your machine — no cloud, no telemetry, no dependencies outside your local environment. Nightfall orchestrates a **Team Lead**, parallel **Engineers**, a **Reviewer**, and a **Memory Manager** to plan, implement, review, and learn from every coding task you give it.

## Quick Start

```bash
# Install globally
npm install -g nightfall

# Run inside any project
cd my-project
nightfall
```

On first launch Nightfall creates `~/.nightfall/config.yaml`, connects to Ollama, pulls the configured model, and drops you into the interactive terminal UI. Run `/init` to set up the memory bank, then describe tasks in plain English.

**Requirements:** Node.js ≥ 20, [Ollama](https://ollama.com) with a pulled model (default: `deepseek-r1:14b`).

## How It Works

```
You submit a task
       │
       ▼
  Team Lead gathers context and produces a plan
       │
       ▼
  You approve (or edit) the plan
       │
       ▼
  Engineers execute subtasks in parallel
       │
       ▼
  Reviewer independently verifies all changes
       │
       ▼
  Memory Manager captures patterns for future tasks
```

## Documentation

| Document | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | Requirements, installation, first run |
| [Configuration](docs/configuration.md) | Config file reference, model selection, providers |
| [Usage Guide](docs/usage.md) | Submitting tasks, approving plans, slash commands |
| [Agent Team](docs/agents.md) | Agent roles, protocols, and custom prompt overrides |
| [Task Lifecycle](docs/task-lifecycle.md) | Planning, execution, review, memory bank, snapshots |
| [Architecture](docs/architecture.md) | Project structure, monorepo layout, development setup |

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
