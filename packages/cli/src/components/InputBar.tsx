import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { THEME } from '../theme.js';

export type InputMode =
  | 'idle' // accept tasks or slash commands
  | 'plan_approval' // awaiting y/n/revised prompt
  | 'running' // task executing — show hint only
  | 'completed' // show completion, accept next task
  | 'init_confirm' // awaiting y/n for /init preview
  | 'new_project' // answering wizard questions
  | 'new_project_plan'; // confirming plan generation (y/n)

interface InputBarProps {
  mode: InputMode;
  onSubmit: (value: string) => void;
  onValueChange?: (value: string) => void;
  completionMessage?: string;
}

export const InputBar: React.FC<InputBarProps> = ({
  mode,
  onSubmit,
  onValueChange,
  completionMessage,
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    setValue('');
    onValueChange?.('');
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
      : mode === 'init_confirm'
        ? 'y to create · n to cancel'
        : mode === 'new_project'
          ? 'Type your answer or /done to finish Q&A'
          : mode === 'new_project_plan'
            ? 'y to generate plan · n to skip'
            : mode === 'completed'
              ? completionMessage
                ? completionMessage + ' — type next task or /help'
                : 'Task complete — type next task or /help'
              : 'Type a task or /help…';

  const promptColor =
    mode === 'plan_approval' || mode === 'init_confirm' || mode === 'new_project_plan'
      ? THEME.warning
      : THEME.accent;

  return (
    <Box borderStyle="single" borderColor={THEME.accent} paddingX={1}>
      <Text color={promptColor} bold>
        {'> '}
      </Text>
      <TextInput
        value={value}
        onChange={(v) => {
          setValue(v);
          onValueChange?.(v);
        }}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />
    </Box>
  );
};
