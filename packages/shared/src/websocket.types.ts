import type { AgentState } from './agent.types.js';
import type { TaskRun, TaskPlan, TaskStatus } from './task.types.js';
import type { FileLock } from './lock.types.js';

// ---- Provider lifecycle events (emitted over WS) ----

export type ProviderLifecycleEvent =
  // Common events (all providers)
  | { type: 'detecting' }
  | { type: 'ready' }
  | { type: 'checking_model'; model: string }
  | { type: 'model_ready'; model: string; contextLength?: number }
  | { type: 'fatal'; message: string }
  // Ollama-specific events
  | { type: 'starting' }
  | { type: 'pulling_model'; model: string; progress: number }
  // OpenRouter-specific events
  | { type: 'validating_api_key' }
  | { type: 'api_key_valid' };

/** @deprecated Use ProviderLifecycleEvent instead */
export type OllamaLifecycleEvent = ProviderLifecycleEvent;

// ---- Client → Server messages ----

export type ClientMessage =
  | { type: 'SUBMIT_TASK'; payload: { prompt: string } }
  | { type: 'APPROVE_PLAN'; payload: { editedPlan?: TaskPlan } }
  | { type: 'REJECT_PLAN'; payload: Record<string, never> }
  | { type: 'INTERRUPT'; payload: Record<string, never> }
  | { type: 'SLASH_COMMAND'; payload: { command: string; args: string } };

// ---- Server → Client messages ----

export type ServerMessage =
  | { type: 'LIFECYCLE'; payload: ProviderLifecycleEvent }
  | { type: 'TASK_STATE'; payload: TaskRun }
  | { type: 'PLAN_READY'; payload: TaskPlan }
  | { type: 'AGENT_UPDATE'; payload: AgentState }
  | { type: 'LOCK_UPDATE'; payload: FileLock[] }
  | { type: 'TASK_COMPLETE'; payload: { status: TaskStatus; summary: string } }
  | { type: 'SLASH_RESULT'; payload: { command: string; output: string } }
  | { type: 'ERROR'; payload: { message: string } };
