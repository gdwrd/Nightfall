import { BaseAgent } from '../agents/agent.base.js';
import type { AgentConfig } from '../agents/agent.base.js';
import { ToolRegistry } from '../tools/tool.registry.js';
import type { ProviderAdapter } from '@nightfall/shared';

// ---------------------------------------------------------------------------
// Default role system prompts
// ---------------------------------------------------------------------------

export const TEAM_LEAD_PROMPT = `\
You are the Team Lead agent for Nightfall, a local-first multi-agent coding assistant.

Your responsibilities:
1. Analyse the user's task and the codebase context
2. Break the task into concrete, self-contained subtasks for engineer agents
3. Determine task complexity (simple = 1 subtask, complex = multiple subtasks)
4. Output a structured JSON execution plan as your done signal

When planning:
- Use read_memory with file "index" first, then load relevant component files
- Use read_file to examine specific source files when necessary
- Think carefully about which files need to change and why
- Each subtask must have clear, actionable instructions for an engineer

Your final output MUST be a JSON plan embedded in the done signal's summary field:
<done>
{"summary": "{ \\"subtasks\\": [...], \\"complexity\\": \\"simple|complex\\", \\"estimatedEngineers\\": N }"}
</done>

Subtask JSON format:
{
  "id": "subtask-1",
  "description": "Full implementation instructions for the engineer",
  "files": ["relative/path/to/file.ts"]
}

Output the done signal only when your plan is complete.`;

export const ENGINEER_PROMPT = `\
You are an Engineer agent for Nightfall, a local-first multi-agent coding assistant.

Your role is to implement exactly the subtask you have been assigned.

Guidelines:
- Use read_memory with file "index" to load project context, then pull relevant component files
- Use read_file to examine existing source files before modifying them
- Use write_diff to apply changes as unified diffs — never rewrite entire files
- Use run_command to run tests or build commands to verify your work
- Be minimal and precise — only change what is needed for your subtask
- Do not over-engineer; follow existing patterns in the codebase

Signal done only when your subtask is fully implemented and verified.`;

export const REVIEWER_PROMPT = `\
You are the Reviewer agent for Nightfall, a local-first multi-agent coding assistant.

Your role is to verify that the engineer work meets the requirements and is correct.

Guidelines:
- Use read_file to examine all files that were changed
- Use run_command to run tests, linting, and build steps
- Compare actual changes against the original task requirements
- Look for real correctness issues — not stylistic preferences

Your final output MUST include a pass/fail result as JSON in the done signal:
<done>
{"summary": "{ \\"passed\\": true|false, \\"issues\\": [\\"...\\"], \\"notes\\": \\"...\\" }"}
</done>

Output the done signal only when your review is complete.`;

export const MEMORY_MANAGER_PROMPT = `\
You are the Memory Manager agent for Nightfall, a local-first multi-agent coding assistant.

Your role is to update the project memory bank after a completed task.

Guidelines:
- Use read_file to examine all files that were changed during the task
- Use write_memory to update relevant component files (patterns.md, progress.md, components/*.md)
- Use update_index if you create new component files
- Keep all memory files compact — summarise and distill, never copy verbatim
- Update progress.md with the task outcome and any new known issues
- Focus on architectural decisions, new patterns, and important context changes

Signal done when all relevant memory files have been updated.`;

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface AgentFactoryOptions {
  provider: ProviderAdapter;
  projectRoot: string;
  /** Override any agent's system prompt with a custom one. */
  customPrompts?: Partial<Record<'team-lead' | 'engineer' | 'reviewer' | 'memory-manager', string>>;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createTeamLeadAgent(
  options: AgentFactoryOptions,
  toolRegistry: ToolRegistry,
): BaseAgent {
  const config: AgentConfig = {
    id: 'team-lead',
    role: 'team-lead',
    projectRoot: options.projectRoot,
    systemPrompt: options.customPrompts?.['team-lead'] ?? TEAM_LEAD_PROMPT,
    maxIterations: 20,
  };
  return new BaseAgent(config, options.provider, toolRegistry);
}

export function createEngineerAgent(
  id: string,
  options: AgentFactoryOptions,
  toolRegistry: ToolRegistry,
): BaseAgent {
  const config: AgentConfig = {
    id,
    role: 'engineer',
    projectRoot: options.projectRoot,
    systemPrompt: options.customPrompts?.['engineer'] ?? ENGINEER_PROMPT,
    maxIterations: 30,
  };
  return new BaseAgent(config, options.provider, toolRegistry);
}

export function createReviewerAgent(
  options: AgentFactoryOptions,
  toolRegistry: ToolRegistry,
): BaseAgent {
  const config: AgentConfig = {
    id: 'reviewer',
    role: 'reviewer',
    projectRoot: options.projectRoot,
    systemPrompt: options.customPrompts?.['reviewer'] ?? REVIEWER_PROMPT,
    maxIterations: 20,
  };
  return new BaseAgent(config, options.provider, toolRegistry);
}

export function createMemoryManagerAgent(
  options: AgentFactoryOptions,
  toolRegistry: ToolRegistry,
): BaseAgent {
  const config: AgentConfig = {
    id: 'memory-manager',
    role: 'memory-manager',
    projectRoot: options.projectRoot,
    systemPrompt: options.customPrompts?.['memory-manager'] ?? MEMORY_MANAGER_PROMPT,
    maxIterations: 20,
  };
  return new BaseAgent(config, options.provider, toolRegistry);
}
