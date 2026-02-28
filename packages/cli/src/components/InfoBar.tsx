import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

interface InfoBarProps {
  provider: { name: string; host: string; port: number };
  memoryInitialized: boolean;
  contextLength: number | null;
}

export const InfoBar: React.FC<InfoBarProps> = ({ provider, memoryInitialized, contextLength }) => {
  const ctxDisplay = contextLength !== null ? formatCtx(contextLength) : '? ctx';
  const memSymbol = memoryInitialized ? '●' : '○';
  const memColor = memoryInitialized ? THEME.success : THEME.dim;
  const memLabel = memoryInitialized ? 'MEM' : 'MEM (uninit)';

  return (
    <Box borderStyle="single" borderColor={THEME.dimBorder} paddingX={1} gap={2}>
      <Text color={THEME.dim}>
        {provider.name}@{provider.host}:{provider.port}
      </Text>
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
