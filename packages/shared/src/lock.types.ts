export interface FileLock {
  path: string;
  lockedBy: string;
  lockedAt: number;
}
