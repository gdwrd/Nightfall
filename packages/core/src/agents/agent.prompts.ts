import type { ToolDefinition } from '../tools/tool.types.js';

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
When your task is fully complete, output a done block:
<done>
{"summary": "Brief description of what was accomplished"}
</done>

Rules:
- Output exactly ONE tool call OR one done block per turn — never mix them with prose
- Always wait for a tool result before calling another tool
- Signal done only when you have everything you need`;

const NO_TOOL_INSTRUCTIONS = `\
## How to Signal Completion
When your task is fully complete, output a done block:
<done>
{"summary": "Brief description of what was accomplished"}
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
