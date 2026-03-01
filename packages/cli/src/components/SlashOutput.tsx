import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

interface SlashOutputProps {
  output: string;
}

/**
 * Renders the result of a slash command in a styled, scrollable bordered box.
 * Output is split on newlines; each line gets its own Text element.
 */
export const SlashOutput: React.FC<SlashOutputProps> = ({ output }) => {
  const lines = output.split('\n');
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={THEME.primary}
      paddingX={1}
      marginY={1}
    >
      {lines.map((line, i) => (
        <Text key={i} color={lineColor(line)}>
          {line}
        </Text>
      ))}
    </Box>
  );
};

function lineColor(line: string): string {
  if (line.startsWith('✓')) return THEME.success;
  if (line.startsWith('!') || line.startsWith('⚠')) return THEME.warning;
  if (line.startsWith('Error')) return THEME.error;
  // Table separator lines (─────)
  if (/^\u2500+$/.test(line)) return THEME.dim;
  // Table header row (all-caps words with spacing)
  if (/^[A-Z][A-Z ]+\s{2,}/.test(line)) return THEME.primary;
  return THEME.text;
}
