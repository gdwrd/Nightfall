import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { THEME } from '../theme.js';

export type InputMode =
  | 'idle' // accept tasks or slash commands
  | 'plan_approval' // awaiting y/n/revised prompt
  | 'running' // task executing — show hint only
  | 'completed'; // show completion, accept next task

interface InputBarProps {
  mode: InputMode;
  onSubmit: (value: string) => void;
  completionMessage?: string;
}

export const InputBar: React.FC<InputBarProps> = ({ mode, onSubmit, completionMessage }) => {
  const [value, setValue] = useState('');

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    setValue('');
    if (trimmed) onSubmit(trimmed);
  };

  if (mode === 'running') {
    return (
      <Box borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
        <Text color={THEME.dim}>Task in progress</Text>
        <Text color={THEME.dimBorder}> · Press Ctrl+C to cancel</Text>
      </Box>
    );
  }

  const placeholder =
    mode === 'plan_approval'
      ? 'y to approve · n to cancel · or type a revised task'
      : mode === 'completed'
        ? completionMessage
          ? completionMessage + ' — type next task or /help'
          : 'Task complete — type next task or /help'
        : 'Type a task or /help…';

  const promptColor = mode === 'plan_approval' ? THEME.warning : THEME.accent;

  return (
    <Box borderStyle="single" borderColor={THEME.accent} paddingX={1}>
      <Text color={promptColor} bold>
        {'> '}
      </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />
    </Box>
  );
};
