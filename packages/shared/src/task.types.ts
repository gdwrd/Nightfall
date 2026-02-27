import type { AgentState } from './agent.types.js';

export type TaskStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'reviewing'
  | 'reworking'
  | 'completed'
  | 'rework_limit_reached'
  | 'cancelled';

export interface Subtask {
  id: string;
  description: string;
  assignedTo: string | null; // agent ID
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  filesTouched: string[];
}

export interface TaskPlan {
  taskId: string;
  prompt: string;
  subtasks: Subtask[];
  complexity: 'simple' | 'complex';
  estimatedEngineers: number;
}

export interface TaskRun {
  id: string;
  prompt: string;
  plan: TaskPlan | null;
  status: TaskStatus;
  reworkCycles: number;
  agentStates: Record<string, AgentState>;
  startedAt: number;
  completedAt: number | null;
  snapshotId: string | null;
}
