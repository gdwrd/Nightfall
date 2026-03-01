import React from 'react';
import { Box, Text } from 'ink';
import type { FileLock, TokenUsage } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface StatusBarProps {
  locks: FileLock[];
  lastTaskTokens?: TokenUsage | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ locks, lastTaskTokens }) => {
  if (locks.length === 0 && !lastTaskTokens) return null;

  return (
    <Box flexDirection="column">
      {locks.length > 0 && (
        <Box borderStyle="single" borderColor={THEME.accent} paddingX={1}>
          <Text color={THEME.warning}>🔒 Locked: </Text>
          <Text color={THEME.textDim}>
            {locks.map((l) => `${l.path} (${l.lockedBy})`).join('  ')}
          </Text>
        </Box>
      )}
      {lastTaskTokens && (
        <Box paddingX={1}>
          <Text color={THEME.textDim}>
            tokens used: {lastTaskTokens.totalTokens.toLocaleString()}
            {'  '}(↑ prompt: {lastTaskTokens.promptTokens.toLocaleString()}
            {'  '}↓ completion: {lastTaskTokens.completionTokens.toLocaleString()})
          </Text>
        </Box>
      )}
    </Box>
  );
};
