import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface HeaderProps {
  model: string;
  taskStatus?: string;
  isThinking: boolean;
  spinnerFrame: number;
  clockTime: string;
}

export const Header: React.FC<HeaderProps> = ({
  model,
  taskStatus,
  isThinking,
  spinnerFrame,
  clockTime,
}) => {
  return (
    <Box
      borderStyle="single"
      borderColor={THEME.accent}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        {isThinking && (
          <Text color={THEME.primary}>{SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]}</Text>
        )}
        <Text bold color={THEME.primary}>
          🌑 NIGHTFALL
        </Text>
      </Box>
      <Box gap={2}>
        {taskStatus && <Text color={taskStatusColor(taskStatus)}>{taskStatus}</Text>}
        <Text color={THEME.accent}>model: {model}</Text>
        <Text color={THEME.dim}>{clockTime}</Text>
      </Box>
    </Box>
  );
};

function taskStatusColor(status: string): string {
  switch (status) {
    case 'planning':
      return THEME.primary;
    case 'awaiting_approval':
      return THEME.warning;
    case 'running':
    case 'reviewing':
    case 'reworking':
      return THEME.primary;
    case 'completed':
      return THEME.success;
    case 'rework_limit_reached':
      return THEME.warning;
    case 'cancelled':
      return THEME.dim;
    default:
      return THEME.dim;
  }
}
