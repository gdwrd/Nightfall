import type { AgentState } from '@nightfall/shared';
import {
  analyzeAndProposeInit,
  type PendingInit,
} from '../../memory/memory.init.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';
import { ToolRegistry } from '../../tools/tool.registry.js';
import { createMemoryManagerAgent } from '../../orchestrator/agent.factory.js';
import type { AgentFactoryOptions } from '../../orchestrator/agent.factory.js';
import { MemoryManager } from '../../memory/memory.manager.js';

/** LLM-proposed file maps awaiting user confirmation. Keyed by projectRoot. */
const pendingInitCache = new Map<string, PendingInit>();

export async function initHandler(ctx: CommandDispatcherContext, args: string): Promise<string> {
  try {
    // ── Confirm: run memory-manager agent to write files ───────────────────
    if (args.trim() === 'confirm') {
      const pending = pendingInitCache.get(ctx.projectRoot);
      if (!pending) {
        return 'No pending init found. Run /init first.';
      }
      pendingInitCache.delete(ctx.projectRoot);

      // Ensure directory structure exists before agent writes
      const memMgr = new MemoryManager(ctx.projectRoot, pending.namespace);
      await memMgr.ensureStructure();

      // Build the agent task from LLM-proposed content
      const agentTask = buildInitAgentTask(pending);

      // Emit initial state so ThinkingPanel appears
      const emitState = (action: string | null, status: AgentState['status'] = 'thinking') => {
        ctx.orchestrator.emit('agent:state', {
          id: 'memory-init',
          role: 'memory-manager' as const,
          status,
          currentAction: action,
          log: [],
        });
      };
      emitState('Writing memory bank files...');

      // Run memory-manager agent (uses write_memory + update_index tools)
      const toolRegistry = new ToolRegistry();
      const agentOptions: AgentFactoryOptions = {
        provider: ctx.provider,
        projectRoot: ctx.projectRoot,
        memoryNamespace: pending.namespace, // pre-resolved — no per-call git exec
        maxIterations: { 'memory-manager': 40 }, // extra headroom for many files
      };
      const agent = createMemoryManagerAgent(agentOptions, toolRegistry);

      // Forward agent state events to orchestrator so ThinkingPanel updates live
      agent.on('state', (s: AgentState) => {
        ctx.orchestrator.emit('agent:state', s);
      });

      await agent.run({ task: agentTask });

      emitState(null, 'done');
      return `✓ Memory bank initialized in .nightfall/memory/${pending.namespace}/`;
    }

    // ── First call: analyze project with LLM ───────────────────────────────
    // Emit agent:state events so the CLI ThinkingPanel shows activity.
    let lastEmit = Date.now();
    const emitState = (action: string | null, status: AgentState['status'] = 'thinking') => {
      ctx.orchestrator.emit('agent:state', {
        id: 'memory-init',
        role: 'memory-manager' as const,
        status,
        currentAction: action,
        log: [],
      });
    };

    emitState('Analyzing project structure...');

    const pending = await analyzeAndProposeInit(
      ctx.projectRoot,
      ctx.provider,
      (accumulated) => {
        const now = Date.now();
        if (now - lastEmit >= 200) {
          emitState(accumulated);
          lastEmit = now;
        }
      },
    );

    emitState(null, 'done');
    pendingInitCache.set(ctx.projectRoot, pending);

    return formatProposal(pending);
  } catch (err) {
    return `Error during /init: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatProposal(pending: PendingInit): string {
  const { fileMap, srcModules } = pending;

  const firstLine = (file: string): string => {
    const content = fileMap.get(file) ?? '';
    const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    return lines[0]?.trim().slice(0, 60) ?? '';
  };

  const lines: string[] = ['Memory bank proposal — based on project analysis:', ''];

  for (const file of ['project.md', 'tech.md', 'patterns.md', 'progress.md']) {
    const hint = firstLine(file);
    lines.push(hint ? `  ${file.padEnd(14)}  ${hint}` : `  ${file}`);
  }

  const componentPaths = srcModules.map((m) => `components/${m.name}.md`);
  for (const [filename] of fileMap) {
    if (filename.startsWith('components/') && !componentPaths.includes(filename)) {
      componentPaths.push(filename);
    }
  }

  if (componentPaths.length > 0) {
    lines.push('  components/');
    for (const cp of componentPaths) {
      const name = cp.replace('components/', '');
      const hint = firstLine(cp);
      lines.push(hint ? `    ${name.padEnd(20)}  ${hint}` : `    ${name}`);
    }
  }

  lines.push('');
  lines.push('Type y to create or n to cancel.');
  return lines.join('\n');
}

function buildInitAgentTask(pending: PendingInit): string {
  const { fileMap, srcModules, projectInfo } = pending;

  const lines: string[] = [
    'Initialize the memory bank for this project for the first time.',
    'Use write_memory to write each file listed below, then call update_index for every component file.',
    '',
  ];

  // Core files
  for (const file of ['project.md', 'tech.md', 'patterns.md', 'progress.md']) {
    const content = fileMap.get(file);
    if (content) {
      lines.push(`=== ${file} ===`);
      lines.push(content.trim());
      lines.push('');
    }
  }

  // Component files from LLM output
  const seenComponents = new Set<string>();
  for (const mod of srcModules) {
    const cp = `components/${mod.name}.md`;
    seenComponents.add(cp);
    const content = fileMap.get(cp);
    if (content) {
      lines.push(`=== ${cp} ===`);
      lines.push(content.trim());
      lines.push('');
    }
  }
  // Extra components the LLM proposed beyond discovered modules
  for (const [filename, content] of fileMap) {
    if (filename.startsWith('components/') && !seenComponents.has(filename)) {
      lines.push(`=== ${filename} ===`);
      lines.push(content.trim());
      lines.push('');
    }
  }

  // If LLM produced nothing, give the agent project context to generate from scratch
  if (fileMap.size === 0) {
    lines.push('No pre-analyzed content is available — generate content from scratch.');
    lines.push(`Project: ${projectInfo.name}`);
    if (projectInfo.description) lines.push(`Description: ${projectInfo.description}`);
    lines.push(`TypeScript: ${projectInfo.hasTypeScript}`);
    lines.push(`Source dirs: ${projectInfo.srcDirs.join(', ') || 'none detected'}`);
    lines.push(`Scripts: ${JSON.stringify(projectInfo.scripts)}`);
    lines.push('');
  }

  lines.push(
    'After writing all component files (components/*.md), call update_index for each one with an accurate one-line description.',
  );

  return lines.join('\n');
}
