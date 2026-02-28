import { useReducer } from 'react';
import type { TaskRun, AgentState, FileLock, OllamaLifecycleEvent } from '@nightfall/shared';
import type { AppAction } from './app.actions.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type AppPhase =
  | 'lifecycle'         // Ollama startup in progress
  | 'idle'             // Ready for user input
  | 'planning'         // Team Lead drafting the plan
  | 'awaiting_approval' // Plan ready, waiting for y/n
  | 'running'          // Engineers / reviewer executing
  | 'completed'        // Task finished
  | 'error';           // Fatal error

export interface AppState {
  phase: AppPhase;
  lifecycleEvent: OllamaLifecycleEvent;
  activeRun: TaskRun | null;
  agentStates: Record<string, AgentState>;
  locks: FileLock[];
  messages: string[];
  errorMessage: string | null;
  slashOutput: string | null;
}

const initialState: AppState = {
  phase: 'lifecycle',
  lifecycleEvent: { type: 'detecting' },
  activeRun: null,
  agentStates: {},
  locks: [],
  messages: [],
  errorMessage: null,
  slashOutput: null,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'LIFECYCLE_EVENT': {
      const base = { ...state, lifecycleEvent: action.event };
      if (action.event.type === 'model_ready') {
        return { ...base, phase: 'idle' };
      }
      if (action.event.type === 'fatal') {
        return { ...base, phase: 'error', errorMessage: action.event.message };
      }
      return base;
    }

    case 'TASK_STATUS': {
      const run = action.run;
      const messages = [...state.messages];
      let phase: AppPhase = state.phase;

      switch (run.status) {
        case 'planning':           phase = 'planning'; break;
        case 'awaiting_approval':  phase = 'awaiting_approval'; break;
        case 'running':
        case 'reviewing':
        case 'reworking':          phase = 'running'; break;
        case 'completed':
          phase = 'completed';
          messages.push('✓ Task completed successfully.');
          break;
        case 'rework_limit_reached':
          phase = 'completed';
          messages.push('⚠ Rework limit reached. Review the changes manually.');
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
      return { ...state, activeRun: null, agentStates: {}, locks: [], slashOutput: null };

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
