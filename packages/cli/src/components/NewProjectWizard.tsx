import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { NewProjectWizardData } from '../store/app.store.js';
import { THEME } from '../theme.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface NewProjectWizardProps {
  data: NewProjectWizardData;
  onAnswer: (answer: string) => void;
  onDone: () => void;
  onCancel: () => void;
  onConfirmPlan: (yes: boolean) => void;
}

export const NewProjectWizard: React.FC<NewProjectWizardProps> = ({
  data,
  onAnswer,
  onDone,
  onCancel,
  onConfirmPlan,
}) => {
  const { status, currentQuestion, questionNumber, history } = data;
  const [inputValue, setInputValue] = useState('');
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  const isCompiling = status === 'compiling_spec' || status === 'compiling_plan';

  useEffect(() => {
    if (!isCompiling) return;
    const id = setInterval(() => setSpinnerFrame((f) => f + 1), 100);
    return () => clearInterval(id);
  }, [isCompiling]);

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    setInputValue('');
    if (!trimmed) return;

    if (trimmed.toLowerCase() === '/cancel') {
      onCancel();
      return;
    }

    if (trimmed.toLowerCase() === '/done' && status === 'gathering') {
      onDone();
      return;
    }

    if (status === 'asking_plan') {
      const lower = trimmed.toLowerCase();
      onConfirmPlan(lower === 'y' || lower === 'yes');
      return;
    }

    onAnswer(trimmed);
  };

  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];

  // Build Q&A pairs from history
  const qaPairs: { question: string; answer: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const q = history[i];
    const a = history[i + 1];
    if (q && q.role === 'assistant' && a && a.role === 'user') {
      qaPairs.push({ question: q.content, answer: a.content });
    }
  }

  const headerLabel =
    status === 'asking_idea'
      ? 'NEW PROJECT'
      : `Question ${questionNumber + 1}`;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={THEME.accent}
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={THEME.primary}>
          ◆ NEW PROJECT WIZARD
        </Text>
        <Text color={THEME.dim}> — {headerLabel}</Text>
      </Box>

      {/* Q&A History */}
      {qaPairs.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {qaPairs.map((pair, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color={THEME.accent} bold>
                Q{i + 1}:{' '}
                <Text color={THEME.textDim} bold={false}>
                  {pair.question}
                </Text>
              </Text>
              <Text color={THEME.dim}>
                {'  → '}
                <Text color={THEME.text}>{pair.answer}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Current question */}
      {currentQuestion && !isCompiling && status !== 'asking_plan' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={THEME.primary} bold>
            {status === 'asking_idea' ? '' : `Q${questionNumber + 1}: `}
            <Text color={THEME.text} bold={false}>
              {currentQuestion}
            </Text>
          </Text>
        </Box>
      )}

      {/* Compiling spinner */}
      {isCompiling && (
        <Box gap={1} marginBottom={1}>
          <Text color={THEME.primary}>{spinner}</Text>
          <Text color={THEME.textDim}>
            {status === 'compiling_spec'
              ? 'Generating specification...'
              : 'Generating development plan...'}
          </Text>
        </Box>
      )}

      {/* Plan confirmation */}
      {status === 'asking_plan' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={THEME.success} bold>
            ✓ Specification saved!
          </Text>
          <Box marginTop={1}>
            <Text color={THEME.warning}>
              Would you like to generate a development plan?{' '}
            </Text>
            <Text color={THEME.textDim}>
              <Text bold color={THEME.success}>Y</Text>es ·{' '}
              <Text bold color={THEME.error}>N</Text>o
            </Text>
          </Box>
        </Box>
      )}

      {/* Input bar */}
      {!isCompiling && (
        <Box borderStyle="single" borderColor={THEME.accent} paddingX={1}>
          <Text color={THEME.accent} bold>
            {'> '}
          </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            placeholder={
              status === 'asking_plan'
                ? 'y to generate plan · n to skip'
                : status === 'asking_idea'
                  ? 'Describe your project idea...'
                  : 'Type your answer or /done to finish Q&A'
            }
          />
        </Box>
      )}

      {/* Key hints */}
      {!isCompiling && status !== 'asking_plan' && (
        <Box marginTop={1}>
          <Text color={THEME.dim}>
            {status === 'gathering'
              ? '/done: finish Q&A · /cancel: abort wizard'
              : '/cancel: abort wizard'}
          </Text>
        </Box>
      )}
    </Box>
  );
};
