import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TaskRun, SnapshotMeta } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface HistoryViewProps {
  runs: TaskRun[];
  snapshots: SnapshotMeta[];
  onRollbackRequest: (snapshotId: string) => void;
  onExit: () => void;
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

function statusIcon(status: string): string {
  if (status === 'completed') return '✅';
  if (status === 'cancelled') return '✗';
  return '!';
}

function statusColor(status: string): string {
  if (status === 'completed') return THEME.success;
  if (status === 'cancelled') return THEME.error;
  return THEME.warning;
}

function duration(run: TaskRun): string {
  if (!run.completedAt) return 'ongoing';
  return `${Math.round((run.completedAt - run.startedAt) / 1000)}s`;
}

function truncate(str: string, len: number): string {
  const clean = str.replace(/\n/g, ' ').trim();
  return clean.length > len ? clean.slice(0, len - 1) + '…' : clean;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  runs,
  snapshots,
  onRollbackRequest,
  onExit,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);

  useInput((input, key) => {
    if (showDetail) {
      if (key.escape) {
        setShowDetail(false);
        return;
      }
      if (input === 'r' || input === 'R') {
        const run = runs[selectedIndex];
        if (run?.snapshotId) onRollbackRequest(run.snapshotId);
        return;
      }
    } else {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(runs.length - 1, i + 1));
        return;
      }
      if (key.return) {
        if (runs.length > 0) setShowDetail(true);
        return;
      }
      if (input === 'r' || input === 'R') {
        const run = runs[selectedIndex];
        if (run?.snapshotId) onRollbackRequest(run.snapshotId);
        return;
      }
      if (key.escape) {
        onExit();
        return;
      }
    }
  });

  if (runs.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={THEME.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={THEME.primary}>
          ◆ TASK HISTORY
        </Text>
        <Box marginTop={1}>
          <Text color={THEME.textDim}>No task history found.</Text>
        </Box>
        <Box marginTop={1} borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
          <Text color={THEME.dim}>Esc: exit</Text>
        </Box>
      </Box>
    );
  }

  if (showDetail) {
    const run = runs[selectedIndex];
    const snap = snapshots.find((s) => s.snapshotId === run.snapshotId);
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={THEME.accent}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={THEME.primary}>
          ◆ TASK DETAIL — [{String(selectedIndex + 1).padStart(3, '0')}]
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={THEME.textDim}>Prompt:  </Text>
            <Text color={THEME.text}>{run.prompt.replace(/\n/g, ' ').trim()}</Text>
          </Box>
          <Box>
            <Text color={THEME.textDim}>Status:  </Text>
            <Text color={statusColor(run.status)}>
              {statusIcon(run.status)} {run.status}
            </Text>
          </Box>
          <Box>
            <Text color={THEME.textDim}>Started: </Text>
            <Text color={THEME.text}>{formatDate(run.startedAt)}</Text>
          </Box>
          <Box>
            <Text color={THEME.textDim}>Duration:</Text>
            <Text color={THEME.text}> {duration(run)}</Text>
          </Box>
          {snap && snap.filesChanged.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={THEME.textDim}>Files:</Text>
              {snap.filesChanged.map((f, i) => (
                <Text key={i} color={THEME.textDim}>
                  {'  '}
                  {f}
                </Text>
              ))}
            </Box>
          )}
        </Box>
        <Box marginTop={1} borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
          {run.snapshotId && <Text color={THEME.dim}>R: rollback · </Text>}
          <Text color={THEME.dim}>Esc: back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={THEME.accent}
      paddingX={2}
      paddingY={1}
    >
      <Text bold color={THEME.primary}>
        ◆ TASK HISTORY
      </Text>
      <Box marginTop={1} flexDirection="column">
        {runs.map((run, i) => {
          const isSelected = i === selectedIndex;
          const num = String(i + 1).padStart(3, '0');
          const date = formatDate(run.startedAt);
          const prompt = truncate(run.prompt, 40);
          const icon = statusIcon(run.status);
          const dur = duration(run);
          return (
            <Box key={run.id}>
              <Text color={isSelected ? THEME.primary : THEME.textDim}>
                {isSelected ? '▶ ' : '  '}[{num}] {date}{'  '}
                {prompt.padEnd(40)}{'  '}
                {icon} {run.status.padEnd(12)} {dur}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
        <Text color={THEME.dim}>↑↓: navigate · Enter: details · R: rollback · Esc: exit</Text>
      </Box>
    </Box>
  );
};
