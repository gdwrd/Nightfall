import React from 'react';
import { Box, Text } from 'ink';
import type { TaskPlan } from '@nightfall/shared';
import { THEME } from '../theme.js';

interface PlanReviewProps {
  plan: TaskPlan;
}

export const PlanReview: React.FC<PlanReviewProps> = ({ plan }) => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.accent} paddingX={1} marginY={1}>
      {/* Plan header */}
      <Box marginBottom={1}>
        <Text bold color={THEME.primary}>
          ◆ EXECUTION PLAN
        </Text>
        <Text color={THEME.dim}>
          {' '}— {plan.complexity} task · {plan.estimatedEngineers} engineer
          {plan.estimatedEngineers !== 1 ? 's' : ''}
        </Text>
      </Box>

      {/* Subtasks */}
      {plan.subtasks.map((subtask, i) => (
        <Box key={subtask.id} marginBottom={1} flexDirection="column">
          <Text color={THEME.textDim}>
            <Text bold color={THEME.accent}>
              [{i + 1}]
            </Text>{' '}
            {subtask.description}
          </Text>
        </Box>
      ))}

      {/* Approval prompt */}
      <Box marginTop={1} borderStyle="single" borderColor={THEME.dimBorder} paddingX={1}>
        <Text color={THEME.warning}>Approve plan? </Text>
        <Text color={THEME.textDim}>
          <Text bold color={THEME.success}>Y</Text>es ·{' '}
          <Text bold color={THEME.error}>N</Text>o ·{' '}
          <Text bold color={THEME.accent}>E</Text>dit · or revise your task
        </Text>
      </Box>
    </Box>
  );
};
