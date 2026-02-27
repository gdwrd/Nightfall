export interface NightfallConfig {
  provider: {
    name: string
    model: string
    host: string
    port: number
  }
  concurrency: {
    max_engineers: number
  }
  task: {
    max_rework_cycles: number
  }
  logs: {
    retention: number
  }
}
