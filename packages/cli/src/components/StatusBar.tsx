import React from 'react';
import { Box, Text } from 'ink';
import type { FileLock } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface StatusBarProps {
  locks: FileLock[];
}

export const StatusBar: React.FC<StatusBarProps> = ({ locks }) => {
  if (locks.length === 0) return null;

  const lockText = locks.map((l) => `${l.path} (${l.lockedBy})`).join('  ');

  return (
    <Box borderStyle="single" borderColor={THEME.accent} paddingX={1}>
      <Text color={THEME.warning}>🔒 Locked: </Text>
      <Text color={THEME.textDim}>{lockText}</Text>
    </Box>
  );
};
