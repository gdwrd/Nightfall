import React from 'react';
import { Box, Text } from 'ink';
import type { ProviderConfig } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface InfoBarProps {
  provider: ProviderConfig;
  memoryInitialized: boolean;
  contextLength: number | null;
}

function formatProvider(p: ProviderConfig): string {
  if (p.name === 'ollama') return `ollama@${p.host}:${p.port}`;
  return p.name;
}

export const InfoBar: React.FC<InfoBarProps> = ({ provider, memoryInitialized, contextLength }) => {
  const ctxDisplay = contextLength !== null ? formatCtx(contextLength) : '? ctx';
  const memSymbol = memoryInitialized ? '●' : '○';
  const memColor = memoryInitialized ? THEME.success : THEME.dim;
  const memLabel = memoryInitialized ? 'MEM' : 'MEM (uninit)';

  return (
    <Box borderStyle="single" borderColor={THEME.dimBorder} paddingX={1} gap={2}>
      <Text color={THEME.dim}>{formatProvider(provider)}</Text>
      <Text color={memColor}>
        {memSymbol} {memLabel}
      </Text>
      <Text color={THEME.dim}>{ctxDisplay}</Text>
    </Box>
  );
};

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ctx`;
  if (n >= 1000) return `${Math.round(n / 1000)}K ctx`;
  return `${n} ctx`;
}
