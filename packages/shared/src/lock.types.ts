export interface FileLock {
  path: string
  lockedBy: string      // agent ID
  lockedAt: number      // timestamp
}
