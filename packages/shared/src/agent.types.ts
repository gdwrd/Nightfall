export type AgentRole = 'team-lead' | 'engineer' | 'reviewer' | 'memory-manager'

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting' | 'done' | 'error'

export interface AgentState {
  id: string                  // e.g. "engineer-1"
  role: AgentRole
  status: AgentStatus
  currentAction: string | null
  log: AgentLogEntry[]
}

export interface AgentLogEntry {
  timestamp: number
  type: 'thought' | 'tool_call' | 'tool_result' | 'message'
  content: string
}
