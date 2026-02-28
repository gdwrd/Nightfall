import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface AgentPanelCollapsedProps {
  label: string;
  state: AgentState;
}

export const AgentPanelCollapsed: React.FC<AgentPanelCollapsedProps> = ({ label, state }) => {
  const isError = state.status === 'error';
  const symbol = isError ? '✗' : '✓';
  const color = isError ? THEME.error : THEME.success;

  // Prefer the summary field; fall back to last log entry content
  const summaryText =
    state.summary ?? state.log[state.log.length - 1]?.content ?? 'completed';

  return (
    <Box borderStyle="single" borderColor={color} paddingX={1}>
      <Text color={color}>{symbol} </Text>
      <Text bold color={THEME.textDim}>
        {label}
      </Text>
      <Text color={THEME.dim}> — {truncate(summaryText, 60)}</Text>
    </Box>
  );
};

function truncate(str: string, max: number): string {
  const single = str.replace(/\n/g, ' ').trim();
  return single.length > max ? single.slice(0, max - 1) + '…' : single;
}
