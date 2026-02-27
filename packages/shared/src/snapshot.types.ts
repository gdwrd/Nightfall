export interface SnapshotMeta {
  snapshotId: string
  taskId: string
  prompt: string
  timestamp: number
  parentSnapshotId: string | null
  filesChanged: string[]
}
