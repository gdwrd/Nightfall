# Configuration

Global config lives at **`~/.nightfall/config.yaml`**. It is created automatically on first run.

## Default Configuration

```yaml
provider:
  name: ollama          # provider adapter
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

## Provider Configuration

### Ollama (local, default)

```yaml
provider:
  name: ollama
  model: deepseek-r1:14b
  host: localhost
  port: 11434
```

Nightfall auto-starts Ollama if it isn't running, and pulls the configured model on first launch. Set `model` to any model available in your Ollama instance (e.g. `qwen2.5-coder:14b`, `llama3.1:8b`).

### OpenRouter (cloud)

```yaml
provider:
  name: openrouter
  model: anthropic/claude-sonnet-4-20250514
  apiKey: sk-or-v1-...
```

OpenRouter provides access to cloud models. Get an API key at [openrouter.ai](https://openrouter.ai). Streaming is supported.

## Configuration Reference

### `provider`

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `"ollama"` \| `"openrouter"` | `"ollama"` | Which provider adapter to use |
| `model` | string | `"deepseek-r1:14b"` | Model identifier |
| `host` | string | `"localhost"` | Ollama host (ollama only) |
| `port` | number | `11434` | Ollama port (ollama only) |
| `apiKey` | string | — | API key (openrouter only) |

### `concurrency`

| Field | Type | Default | Description |
|---|---|---|---|
| `max_engineers` | number | `3` | Maximum parallel engineer agents per task |

### `task`

| Field | Type | Default | Description |
|---|---|---|---|
| `max_rework_cycles` | number | `3` | Maximum reviewer rework loops before escalating to you |

### `logs`

| Field | Type | Default | Description |
|---|---|---|---|
| `retention` | number | `50` | Maximum task logs kept per project |

## Changing the Model

Edit `~/.nightfall/config.yaml` and set `provider.model`:

```yaml
provider:
  model: qwen2.5-coder:14b
```

Nightfall pulls the model automatically on the next launch if it isn't already present.
