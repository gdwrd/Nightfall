import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState } from '@nightfall/shared';
import { THEME } from '../theme.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface ThinkingPanelProps {
  agentStates: Record<string, AgentState>;
  spinnerFrame: number;
}

export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ agentStates, spinnerFrame }) => {
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];

  // All agents that are not yet done / errored
  const activeAgents = Object.values(agentStates).filter(
    (a) => a.status !== 'done' && a.status !== 'error',
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
      {activeAgents.length === 0 ? (
        // No agent state yet — model is warming up
        <Box gap={1}>
          <Text color={THEME.primary}>{spinner}</Text>
          <Text color={THEME.dim}>waiting for model...</Text>
        </Box>
      ) : (
        activeAgents.map((agent) => <AgentThought key={agent.id} agent={agent} spinner={spinner} />)
      )}
    </Box>
  );
};

// ── Per-agent row ────────────────────────────────────────────────────────────

interface AgentThoughtProps {
  agent: AgentState;
  spinner: string;
}

const AgentThought: React.FC<AgentThoughtProps> = ({ agent, spinner }) => {
  const isActing = agent.status === 'acting';
  const statusColor = isActing ? THEME.warning : THEME.primary;
  const label = isActing ? 'acting' : 'thinking';

  // currentAction holds the live streaming LLM output (updated every ~200ms)
  const text = agent.currentAction?.trim() ?? '';

  return (
    <Box flexDirection="column">
      {/* Header row: spinner + agent id + status */}
      <Box gap={1}>
        <Text color={statusColor}>{spinner}</Text>
        <Text color={statusColor} bold>
          {agent.id}
        </Text>
        <Text color={THEME.dim}>[{label}]</Text>
      </Box>
      {/* Streaming thought content — last 120 chars to fit the terminal */}
      {text ? (
        <Text color={THEME.textDim} dimColor>
          {tail(text, 120)}
        </Text>
      ) : (
        <Text color={THEME.dim} dimColor>
          waiting...
        </Text>
      )}
    </Box>
  );
};

/** Return the last `n` characters of a string, collapsing newlines. */
function tail(str: string, n: number): string {
  const single = str.replace(/\n+/g, ' ').trim();
  return single.length > n ? '…' + single.slice(single.length - n) : single;
}
