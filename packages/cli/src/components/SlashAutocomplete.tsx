import React from 'react';
import { Box, Text } from 'ink';
import { SLASH_COMMANDS } from '../slash.commands.js';
import { THEME } from '../theme.js';

interface SlashAutocompleteProps {
  input: string;
}

/**
 * Renders an inline hint box above the input bar when the user is typing a
 * slash command.  Filters the command registry by prefix and updates on every
 * keystroke.  Returns null when the input is empty or has no matches.
 */
export const SlashAutocomplete: React.FC<SlashAutocompleteProps> = ({ input }) => {
  if (!input.startsWith('/')) return null;

  const matches = Object.entries(SLASH_COMMANDS).filter(([cmd]) =>
    cmd.startsWith(input.toLowerCase()),
  );

  if (matches.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.dimBorder}
      paddingX={1}
      marginBottom={0}
    >
      {matches.map(([cmd, desc]) => (
        <Box key={cmd}>
          <Text color={THEME.primary} bold>
            {cmd.padEnd(14)}
          </Text>
          <Text color={THEME.textDim}>{desc}</Text>
        </Box>
      ))}
    </Box>
  );
};
