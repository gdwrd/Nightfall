import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';

const VISIBLE_ROWS = 12;

interface ModelEntry {
  id: string;
  label: string;
  contextLength?: number;
}

interface ModelViewProps {
  provider: string;
  currentModel: string;
  models: ModelEntry[];
  onSelect: (modelId: string) => void;
  onExit: () => void;
}

export const ModelView: React.FC<ModelViewProps> = ({
  provider,
  currentModel,
  models,
  onSelect,
  onExit,
}) => {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const filtered = useMemo(() => {
    if (!filter) return models;
    const lower = filter.toLowerCase();
    return models.filter((m) => m.id.toLowerCase().includes(lower));
  }, [models, filter]);

  // Keep cursor in bounds when the filtered list shrinks
  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onExit();
      return;
    }

    if (key.upArrow) {
      const next = Math.max(0, clampedIndex - 1);
      setSelectedIndex(next);
      if (next < scrollOffset) setScrollOffset(next);
      return;
    }

    if (key.downArrow) {
      const next = Math.min(filtered.length - 1, clampedIndex + 1);
      setSelectedIndex(next);
      if (next >= scrollOffset + VISIBLE_ROWS) setScrollOffset(next - VISIBLE_ROWS + 1);
      return;
    }

    if (key.return) {
      const model = filtered[clampedIndex];
      if (model) onSelect(model.id);
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelectedIndex(0);
      setScrollOffset(0);
      return;
    }

    // Printable characters — append to filter
    if (input && !key.ctrl && !key.meta) {
      setFilter((f) => f + input);
      setSelectedIndex(0);
      setScrollOffset(0);
    }
  });

  const visibleModels = filtered.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);
  const remaining = filtered.length - (scrollOffset + VISIBLE_ROWS);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.accent} paddingX={2} paddingY={1}>
      <Text bold color={THEME.primary}>
        ◆ MODEL PICKER — {provider.toUpperCase()}
      </Text>

      {/* Filter bar */}
      <Box marginTop={1}>
        <Text color={THEME.dim}>filter: </Text>
        <Text color={THEME.text}>{filter}</Text>
        <Text color={THEME.primary}>▌</Text>
        <Text color={THEME.dim}>  ({filtered.length} of {models.length})</Text>
      </Box>

      {/* Model list */}
      <Box marginTop={1} flexDirection="column">
        {visibleModels.length === 0 && (
          <Text color={THEME.textDim}>No models match "{filter}"</Text>
        )}
        {visibleModels.map((model, i) => {
          const absIndex = scrollOffset + i;
          const isSelected = absIndex === clampedIndex;
          const isCurrent = model.id === currentModel;
          return (
            <Box key={model.id}>
              <Text color={isSelected ? THEME.primary : isCurrent ? THEME.success : THEME.textDim}>
                {isSelected ? '▶ ' : '  '}
                {model.label}
                {isCurrent ? '  ← current' : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Scroll hint */}
      {remaining > 0 && (
        <Text color={THEME.dim}>  ↓ {remaining} more</Text>
      )}
      {filtered.length > VISIBLE_ROWS && remaining <= 0 && (
        <Text color={THEME.dim}>  (end of list)</Text>
      )}

      {/* Key hints */}
      <Box marginTop={1}>
        <Text color={THEME.dim}>Type to filter · ↑↓: navigate · Enter: select · Esc: cancel</Text>
      </Box>
    </Box>
  );
};
