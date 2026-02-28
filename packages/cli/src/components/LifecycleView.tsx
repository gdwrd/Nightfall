import React from 'react';
import { Box, Text } from 'ink';
import type { ProviderLifecycleEvent } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface LifecycleViewProps {
  event: ProviderLifecycleEvent;
}

function formatEvent(event: ProviderLifecycleEvent): { label: string; color: string } {
  switch (event.type) {
    case 'detecting':
      return { label: 'Detecting provider...', color: THEME.dim };
    case 'starting':
      return { label: 'Starting local provider...', color: THEME.primary };
    case 'ready':
      return { label: 'Provider is running', color: THEME.success };
    case 'checking_model':
      return { label: `Checking model: ${event.model}`, color: THEME.dim };
    case 'pulling_model':
      return {
        label: `Pulling model: ${event.model} (${event.progress}%)`,
        color: THEME.primary,
      };
    case 'model_ready':
      return { label: `Model ready: ${event.model}`, color: THEME.success };
    case 'validating_api_key':
      return { label: 'Validating API key...', color: THEME.dim };
    case 'api_key_valid':
      return { label: 'API key validated', color: THEME.success };
    case 'fatal':
      return { label: `Fatal: ${event.message}`, color: THEME.error };
  }
}

export const LifecycleView: React.FC<LifecycleViewProps> = ({ event }) => {
  const { label, color } = formatEvent(event);
  const isPulling = event.type === 'pulling_model';

  return (
    <Box flexDirection="column" paddingY={1} paddingX={2}>
      <Text bold color={THEME.primary}>
        🌑 NIGHTFALL
      </Text>
      <Box marginTop={1}>
        <Text color={color}>{label}</Text>
      </Box>
      {isPulling && (
        <Box marginTop={1}>
          <ProgressBar value={event.progress} />
        </Box>
      )}
    </Box>
  );
};

interface ProgressBarProps {
  value: number; // 0-100
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value }) => {
  const width = 40;
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return (
    <Text>
      <Text color={THEME.accent}>{bar}</Text>
      <Text color={THEME.dim}> {value}%</Text>
    </Text>
  );
};
