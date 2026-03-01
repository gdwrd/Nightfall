import { useReducer } from 'react';
import type {
  TaskRun,
  AgentState,
  FileLock,
  ProviderLifecycleEvent,
  SnapshotMeta,
  NightfallConfig,
  TokenUsage,
} from '@nightfall/shared';
import type { AppAction } from './app.actions.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type AppPhase =
  | 'lifecycle' // Provider startup in progress
  | 'idle' // Ready for user input
  | 'classifying' // Classifier agent running
  | 'planning' // Team Lead drafting the plan
  | 'awaiting_approval' // Plan ready, waiting for y/n/e
  | 'editing_plan' // External editor open for plan editing
  | 'running' // Engineers / reviewer executing
  | 'answered' // Question answered
  | 'completed' // Task finished
  | 'error' // Fatal error
  | 'provider_setup' // Provider setup wizard active
  | 'history_view' // Browsing task history
  | 'rollback_confirm' // Awaiting rollback cascade confirmation
  | 'model_view' // Picking an LLM model
  | 'settings_view' // Editing configuration
  | 'new_project'; // New project wizard active

export interface ModelEntry {
  id: string;
  label: string;
  contextLength?: number;
}

export interface ModelViewData {
  provider: string;
  currentModel: string;
  models: ModelEntry[];
}

export interface SettingsViewData {
  config: NightfallConfig;
}

export interface NewProjectWizardData {
  sessionId: string;
  status: 'asking_idea' | 'gathering' | 'compiling_spec' | 'asking_plan' | 'compiling_plan';
  currentQuestion: string | null;
  questionNumber: number;
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface AppState {
  phase: AppPhase;
  lifecycleEvent: ProviderLifecycleEvent;
  activeRun: TaskRun | null;
  agentStates: Record<string, AgentState>;
  locks: FileLock[];
  messages: string[];
  errorMessage: string | null;
  providerSetupError: string | null;
  slashOutput: string | null;
  historyRuns: TaskRun[];
  historySnapshots: SnapshotMeta[];
  rollbackChain: SnapshotMeta[];
  pendingRollbackSnapshotId: string | null;
  contextLength: number | null;
  modelViewData: ModelViewData | null;
  settingsViewData: SettingsViewData | null;
  newProjectData: NewProjectWizardData | null;
  lastTaskTokens: TokenUsage | null;
}

const initialState: AppState = {
  phase: 'lifecycle',
  lifecycleEvent: { type: 'detecting' },
  activeRun: null,
  agentStates: {},
  locks: [],
  messages: [],
  errorMessage: null,
  providerSetupError: null,
  slashOutput: null,
  historyRuns: [],
  historySnapshots: [],
  rollbackChain: [],
  pendingRollbackSnapshotId: null,
  contextLength: null,
  modelViewData: null,
  settingsViewData: null,
  newProjectData: null,
  lastTaskTokens: null,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LIFECYCLE_EVENT': {
      const base = { ...state, lifecycleEvent: action.event };
      if (action.event.type === 'model_ready') {
        return {
          ...base,
          phase: 'idle',
          contextLength: action.event.contextLength ?? null,
        };
      }
      if (action.event.type === 'fatal') {
        return { ...base, phase: 'provider_setup', providerSetupError: action.event.message };
      }
      return base;
    }

    case 'TASK_STATUS': {
      // Don't let stale task:status events override new_project phase
      if (state.phase === 'new_project') return state;

      const run = action.run;
      const messages = [...state.messages];
      let phase: AppPhase = state.phase;
      let lastTaskTokens = state.lastTaskTokens;

      switch (run.status) {
        case 'classifying':
          phase = 'classifying';
          break;
        case 'planning':
          phase = 'planning';
          break;
        case 'awaiting_approval':
          phase = 'awaiting_approval';
          break;
        case 'running':
        case 'reviewing':
        case 'reworking':
        case 'answering':
          phase = 'running';
          break;
        case 'answered':
          phase = 'answered';
          messages.push(run.answer ?? 'Question answered.');
          break;
        case 'completed':
          phase = 'completed';
          messages.push('✓ Task completed successfully.');
          if (run.warnings && run.warnings.length > 0) {
            for (const warning of run.warnings) {
              messages.push(`⚠ ${warning}`);
            }
          }
          lastTaskTokens = run.tokenUsage ?? null;
          break;
        case 'rework_limit_reached':
          phase = 'completed';
          messages.push('⚠ Rework limit reached. Review the changes manually.');
          lastTaskTokens = run.tokenUsage ?? null;
          break;
        case 'cancelled':
          phase = 'idle';
          messages.push('Task cancelled.');
          break;
      }

      return {
        ...state,
        phase,
        activeRun: run,
        agentStates: { ...run.agentStates },
        messages: messages.slice(-10),
        lastTaskTokens,
      };
    }

    case 'AGENT_STATE':
      return {
        ...state,
        agentStates: { ...state.agentStates, [action.state.id]: action.state },
      };

    case 'LOCK_UPDATE':
      return { ...state, locks: action.locks };

    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages.slice(-9), action.message] };

    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };

    case 'SET_SLASH_OUTPUT':
      return { ...state, slashOutput: action.output };

    case 'SET_PHASE':
      return { ...state, phase: action.phase };

    case 'RESET_TASK':
      return {
        ...state,
        activeRun: null,
        agentStates: {},
        locks: [],
        slashOutput: null,
        lastTaskTokens: null,
      };

    case 'UPDATE_PLAN':
      return {
        ...state,
        activeRun: state.activeRun ? { ...state.activeRun, plan: action.plan } : null,
      };

    case 'SET_HISTORY_DATA':
      return {
        ...state,
        phase: 'history_view',
        historyRuns: action.runs,
        historySnapshots: action.snapshots,
      };

    case 'SET_ROLLBACK_CHAIN':
      return {
        ...state,
        phase: 'rollback_confirm',
        rollbackChain: action.chain,
        pendingRollbackSnapshotId: action.snapshotId,
      };

    case 'SET_MODEL_VIEW':
      return { ...state, phase: 'model_view', modelViewData: action.data };

    case 'SET_SETTINGS_VIEW':
      return { ...state, phase: 'settings_view', settingsViewData: action.data };

    case 'SET_NEW_PROJECT':
      return { ...state, phase: 'new_project', newProjectData: action.data };

    case 'UPDATE_NEW_PROJECT':
      // No-op when newProjectData is null — prevents stale slash:result
      // events from re-opening the wizard after cancel.
      if (!state.newProjectData) return state;
      return {
        ...state,
        phase: 'new_project',
        newProjectData: { ...state.newProjectData, ...action.partial },
      };

    case 'APPEND_NEW_PROJECT_HISTORY':
      return {
        ...state,
        newProjectData: state.newProjectData
          ? {
              ...state.newProjectData,
              history: [...state.newProjectData.history, action.entry],
            }
          : null,
      };

    case 'CLEAR_NEW_PROJECT':
      return { ...state, phase: 'idle', newProjectData: null };

    case 'HISTORY_CLEARED':
      return {
        ...state,
        phase: state.phase === 'lifecycle' || state.phase === 'error' ? state.phase : 'idle',
        activeRun: null,
        agentStates: {},
        historyRuns: [],
        historySnapshots: [],
        messages: [],
        slashOutput: null,
        lastTaskTokens: null,
      };

    case 'PLAN_EDIT_FAILED':
      return {
        ...state,
        phase: 'awaiting_approval',
        messages: [...state.messages.slice(-9), `⚠ Editor: ${action.message}`],
      };

    case 'SET_PROVIDER_SETUP':
      return { ...state, phase: 'provider_setup', providerSetupError: action.errorMessage };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppStore(): [AppState, React.Dispatch<AppAction>] {
  return useReducer(reducer, initialState);
}
