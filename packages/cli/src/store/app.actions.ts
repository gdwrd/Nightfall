import type {
  TaskRun,
  TaskPlan,
  AgentState,
  FileLock,
  ProviderLifecycleEvent,
  SnapshotMeta,
} from '@nightfall/shared';
import type { AppPhase, ModelViewData, SettingsViewData } from './app.store.js';

// ---------------------------------------------------------------------------
// Action Types
// ---------------------------------------------------------------------------

export type AppAction =
  | { type: 'LIFECYCLE_EVENT'; event: ProviderLifecycleEvent }
  | { type: 'TASK_STATUS'; run: TaskRun }
  | { type: 'AGENT_STATE'; state: AgentState }
  | { type: 'LOCK_UPDATE'; locks: FileLock[] }
  | { type: 'ADD_MESSAGE'; message: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_SLASH_OUTPUT'; output: string | null }
  | { type: 'SET_PHASE'; phase: AppPhase }
  | { type: 'RESET_TASK' }
  | { type: 'UPDATE_PLAN'; plan: TaskPlan }
  | { type: 'SET_HISTORY_DATA'; runs: TaskRun[]; snapshots: SnapshotMeta[] }
  | { type: 'SET_ROLLBACK_CHAIN'; chain: SnapshotMeta[]; snapshotId: string }
  | { type: 'SET_MODEL_VIEW'; data: ModelViewData }
  | { type: 'SET_SETTINGS_VIEW'; data: SettingsViewData };
