import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { SnapshotMeta } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface RollbackConfirmProps {
  chain: SnapshotMeta[];
  snapshotId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function truncate(str: string, len: number): string {
  const clean = str.replace(/\n/g, ' ').trim();
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean;
}

export const RollbackConfirm: React.FC<RollbackConfirmProps> = ({
  chain,
  snapshotId,
  onConfirm,
  onCancel,
}) => {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  const isCascade = chain.length > 1;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={THEME.warning}
      paddingX={2}
      paddingY={1}
    >
      <Text bold color={THEME.warning}>
        ⚠ ROLLBACK CONFIRMATION
      </Text>

      <Box marginTop={1}>
        <Text color={THEME.warning}>
          {isCascade
            ? `This will roll back ${chain.length} snapshots (cascade):`
            : 'This will roll back 1 snapshot:'}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {chain.map((snap) => {
          const isTarget = snap.snapshotId === snapshotId;
          return (
            <Box key={snap.snapshotId}>
              <Text color={isTarget ? THEME.primary : THEME.textDim}>
                {isTarget ? '  → ' : '    '}
                {snap.snapshotId}{'  '}
                {formatDate(snap.timestamp)}{'  '}
                {truncate(snap.prompt, 36)}
                {isTarget ? '  ← target' : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={THEME.error}>This cannot be undone.</Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
        <Text color={THEME.warning}>Confirm rollback? </Text>
        <Text color={THEME.textDim}>
          <Text bold color={THEME.success}>
            Y
          </Text>
          es ·{' '}
          <Text bold color={THEME.error}>
            N
          </Text>
          o
        </Text>
      </Box>
    </Box>
  );
};
