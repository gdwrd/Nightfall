// @nightfall/core — entry point
export * from './config/config.defaults.js';
export * from './config/config.loader.js';
export * from './ollama/ollama.lifecycle.js';
export * from './providers/provider.interface.js';
export * from './providers/ollama/ollama.adapter.js';
export * from './providers/provider.factory.js';
export * from './memory/memory.parser.js';
export * from './memory/memory.writer.js';
export { MemoryManager } from './memory/memory.manager.js';
export { initializeMemoryBank } from './memory/memory.init.js';
export { LockRegistry } from './locks/lock.registry.js';
export type { LockRegistryOptions } from './locks/lock.registry.js';
export { SnapshotManager } from './snapshots/snapshot.manager.js';
// Phase 9 — Agent Base Class
export { BaseAgent } from './agents/agent.base.js';
export type { AgentConfig, AgentRunOptions, AgentRunResult } from './agents/agent.base.js';
export { parseToolCall, parseDone } from './agents/agent.parser.js';
export type { DoneSignal } from './agents/agent.parser.js';
export { buildSystemPrompt, buildToolsDescription } from './agents/agent.prompts.js';
// Phase 8 — Agent Tool System
export { ToolRegistry } from './tools/tool.registry.js';
export { ToolNotAllowedError } from './tools/tool.types.js';
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  ToolImpl,
  ToolParameter,
} from './tools/tool.types.js';
export { readMemoryTool } from './tools/tools/read_memory.js';
export { readFileTool } from './tools/tools/read_file.js';
export { writeDiffTool, setLockRegistry } from './tools/tools/write_diff.js';
export { runCommandTool, setRunCommandAbortSignal } from './tools/tools/run_command.js';
export { assignTaskTool, setAssignTaskBus } from './tools/tools/assign_task.js';
export type { AssignTaskMessage } from './tools/tools/assign_task.js';
export { requestReviewTool, setRequestReviewBus } from './tools/tools/request_review.js';
export type { RequestReviewMessage } from './tools/tools/request_review.js';
export { writeMemoryTool } from './tools/tools/write_memory.js';
export { updateIndexTool } from './tools/tools/update_index.js';
