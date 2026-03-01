import type { AgentRole, AgentState } from './agent.types.js';

export interface AgentMessage {
  timestamp: string;
  from: AgentRole;
  to: AgentRole;
  type: 'assign' | 'review';
  payload: unknown;
}

export type TaskStatus =
  | 'classifying'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'reviewing'
  | 'reworking'
  | 'answering'
  | 'answered'
  | 'completed'
  | 'rework_limit_reached'
  | 'cancelled';

export interface Subtask {
  id: string;
  description: string;
  assignedTo: string | null; // agent ID
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  filesTouched: string[];
  /** IDs of subtasks that must reach 'done' before this one can start. */
  dependsOn?: string[];
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
  requestType: 'coding_task' | 'question' | 'new_project' | null;
  answer: string | null;
  /** Aggregated token usage across all agents for this task run. */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** Non-fatal warnings accumulated during the task (e.g. snapshot errors). */
  warnings?: string[];
  /** Audit log of inter-agent messages (assign_task and request_review calls). */
  agent_messages?: AgentMessage[];
}
