import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState, AgentLogEntry } from '@nightfall/shared';
import { THEME } from '../theme.js';

export interface AgentPanelProps {
  label: string;
  state?: AgentState;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ label, state }) => {
  const status = state?.status ?? 'idle';
  const isThinking = status === 'thinking';
  const isActing = status === 'acting';
  const isActive = isThinking || isActing;
  const isDone = status === 'done';
  const isError = status === 'error';

  const dotSymbol = isDone ? '✓' : isError ? '✗' : isActive ? '●' : '○';
  const dotColor = isDone
    ? THEME.success
    : isError
      ? THEME.error
      : isThinking
        ? THEME.accent
        : isActing
          ? THEME.text
          : THEME.dim;

  const borderColor = isActive ? THEME.accent : isDone ? THEME.success : THEME.dimBorder;

  const labelColor = isThinking
    ? THEME.accent
    : isActing
      ? THEME.text
      : THEME.textDim;

  // Recent log entries (last 4)
  const recentLog = (state?.log ?? []).slice(-4);

  return (
    <Box borderStyle="single" borderColor={borderColor} flexDirection="column" paddingX={1}>
      {/* Header row */}
      <Box justifyContent="space-between">
        <Text bold color={labelColor}>
          {label}
        </Text>
        <Text color={dotColor}>
          {dotSymbol} {status}
        </Text>
      </Box>

      {/* Current action */}
      {state?.currentAction && (
        <Text color={THEME.textDim} dimColor>
          {truncate(state.currentAction, 50)}
        </Text>
      )}

      {/* Log lines */}
      {recentLog.map((entry, i) => (
        <LogLine key={`${entry.timestamp}-${i}`} entry={entry} />
      ))}

      {/* Placeholder when idle/waiting */}
      {!state?.currentAction && recentLog.length === 0 && (
        <Text color={THEME.dim} dimColor>
          waiting...
        </Text>
      )}
    </Box>
  );
};

const LogLine = React.memo<{ entry: AgentLogEntry }>(({ entry }) => {
  const prefix = entry.type === 'tool_call' ? '⚙ ' : entry.type === 'tool_result' ? '← ' : '  ';
  const color =
    entry.type === 'tool_call'
      ? THEME.accent
      : entry.type === 'tool_result'
        ? THEME.dim
        : THEME.textDim;

  return (
    <Text color={color} dimColor>
      {prefix}
      {truncate(entry.content, 55)}
    </Text>
  );
});

LogLine.displayName = 'LogLine';

function truncate(str: string, max: number): string {
  const single = str.replace(/\n/g, ' ').trim();
  return single.length > max ? single.slice(0, max - 1) + '…' : single;
}
