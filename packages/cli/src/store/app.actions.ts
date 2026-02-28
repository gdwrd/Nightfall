import type { TaskRun, AgentState, FileLock, OllamaLifecycleEvent } from '@nightfall/shared';
import type { AppPhase } from './app.store.js';

// ---------------------------------------------------------------------------
// Action Types
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: 'LIFECYCLE_EVENT'; event: OllamaLifecycleEvent }
  | { type: 'TASK_STATUS'; run: TaskRun }
  | { type: 'AGENT_STATE'; state: AgentState }
  | { type: 'LOCK_UPDATE'; locks: FileLock[] }
  | { type: 'ADD_MESSAGE'; message: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_SLASH_OUTPUT'; output: string | null }
  | { type: 'SET_PHASE'; phase: AppPhase }
  | { type: 'RESET_TASK' };
