import type { ToolDefinition } from '../tools/tool.types.js';

/**
 * System prompt used by the memory compaction routine.
 * Instructs the LLM to summarize and deduplicate memory file entries
 * while preserving all unique learnings.
 */
export const COMPACT_MEMORY_SYSTEM_PROMPT = `You are a memory compaction assistant. Your task is to summarize and deduplicate the memory entries in a markdown file.

Rules:
- Preserve ALL unique learnings, patterns, and architectural decisions
- Remove exact duplicates and near-duplicates (same information expressed differently)
- Merge closely related entries into concise, combined entries
- Keep the same markdown format as the input (headings, bullet points, etc.)
- Do not add new information or change the meaning of existing entries
- Do not include explanations, preamble, or commentary — output ONLY the compacted markdown content`;

/**
 * Render a list of tool definitions as a compact markdown description
 * the LLM can use to understand what tools are available.
 */
export function buildToolsDescription(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';

  return tools
    .map((tool) => {
      const params = Object.entries(tool.parameters)
        .map(
          ([name, p]) =>
            `    - ${name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`,
        )
        .join('\n');
      return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
    })
    .join('\n\n');
}

const TOOL_INSTRUCTIONS = `\
## How to Use Tools
When you need to call a tool, output ONLY a tool call block (no surrounding prose):
<tool_call>
{"tool": "tool_name", "parameters": {"param1": "value1"}}
</tool_call>

Wait for the result before proceeding. The result will arrive in the next message.

## How to Signal Completion
When your task is fully complete, output a done block containing your role-specific JSON result
(the exact schema is defined in your role instructions above):
<done>
{ ...your structured result as defined in your role instructions... }
</done>

Rules:
- Output exactly ONE tool call OR one done block per turn — never mix them with prose
- Always wait for a tool result before calling another tool
- Signal done only when you have everything you need
- The done block must contain valid JSON matching your role's schema`;

const NO_TOOL_INSTRUCTIONS = `\
## How to Signal Completion
When your task is fully complete, output a done block containing your role-specific JSON result:
<done>
{ ...your structured result as defined in your role instructions... }
</done>`;

/**
 * Compose the final system prompt by appending tool descriptions and
 * protocol instructions to the agent's role-specific base prompt.
 */
export function buildSystemPrompt(basePrompt: string, tools: ToolDefinition[]): string {
  if (tools.length === 0) {
    return `${basePrompt}\n\n${NO_TOOL_INSTRUCTIONS}`;
  }

  const toolsDesc = buildToolsDescription(tools);
  return `${basePrompt}\n\n## Available Tools\n\n${toolsDesc}\n\n${TOOL_INSTRUCTIONS}`;
}
