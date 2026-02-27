import type { NightfallConfig } from '@nightfall/shared'

export const DEFAULT_CONFIG: NightfallConfig = {
  provider: {
    name: 'ollama',
    model: 'deepseek-r1:14b',
    host: 'localhost',
    port: 11434,
  },
  concurrency: {
    max_engineers: 3,
  },
  task: {
    max_rework_cycles: 3,
  },
  logs: {
    retention: 50,
  },
}
