import React from 'react';
import { Box } from 'ink';
import type { AgentState } from '@nightfall/shared';
import { AgentPanel } from './AgentPanel.js';

interface AgentGridProps {
  agentStates: Record<string, AgentState>;
  /** Number of engineer slots to show (determined by plan's estimatedEngineers). */
  engineerCount: number;
}

export const AgentGrid: React.FC<AgentGridProps> = ({ agentStates, engineerCount }) => {
  // Build the list of panels to display
  const panels: Array<{ id: string; label: string }> = [
    { id: 'team-lead', label: 'TEAM LEAD' },
    ...Array.from({ length: Math.max(engineerCount, 1) }, (_, i) => ({
      id: `engineer-${i + 1}`,
      label: `ENGINEER ${i + 1}`,
    })),
    { id: 'reviewer', label: 'REVIEWER' },
  ];

  // Pair into rows of 2
  const rows: Array<[typeof panels[0], typeof panels[0] | undefined]> = [];
  for (let i = 0; i < panels.length; i += 2) {
    rows.push([panels[i]!, panels[i + 1]]);
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row">
          <Box flexGrow={1} flexBasis={0}>
            <AgentPanel
              label={row[0].label}
              state={agentStates[row[0].id]}
              collapsed={isPanelCollapsed(row[0].id, agentStates)}
            />
          </Box>
          {row[1] && (
            <Box flexGrow={1} flexBasis={0}>
              <AgentPanel
                label={row[1].label}
                state={agentStates[row[1].id]}
                collapsed={isPanelCollapsed(row[1].id, agentStates)}
              />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};

/**
 * Collapse a panel when it is done AND at least one other panel is still active.
 * If all panels are done, keep them expanded for the summary.
 */
function isPanelCollapsed(id: string, agentStates: Record<string, AgentState>): boolean {
  const state = agentStates[id];
  if (!state || state.status !== 'done') return false;

  const hasActiveOthers = Object.entries(agentStates).some(
    ([otherId, s]) => otherId !== id && (s.status === 'thinking' || s.status === 'acting'),
  );

  return hasActiveOthers;
}
