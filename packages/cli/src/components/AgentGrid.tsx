import React from 'react';
import { Box, useStdout } from 'ink';
import type { AgentState } from '@nightfall/shared';
import { AgentPanel } from './AgentPanel.js';
import { AgentPanelCollapsed } from './AgentPanelCollapsed.js';

interface AgentGridProps {
  agentStates: Record<string, AgentState>;
  /** Number of engineer slots to show (determined by plan's estimatedEngineers). */
  engineerCount: number;
}

export const AgentGrid: React.FC<AgentGridProps> = ({ agentStates, engineerCount }) => {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const singleColumn = columns < 80;

  // Build the full list of possible panels
  const allPanels: Array<{ id: string; label: string }> = [
    { id: 'team-lead', label: 'TEAM LEAD' },
    ...Array.from({ length: Math.max(engineerCount, 1) }, (_, i) => ({
      id: `engineer-${i + 1}`,
      label: `ENGINEER ${i + 1}`,
    })),
    { id: 'reviewer', label: 'REVIEWER' },
  ];

  // Only show agents that have been activated (have state in agentStates)
  const panels = allPanels.filter((p) => agentStates[p.id] !== undefined);

  if (panels.length === 0) return null;

  const renderPanel = (panel: (typeof panels)[0]) => {
    const panelState = agentStates[panel.id];
    if (isPanelCollapsed(panel.id, agentStates) && panelState) {
      return <AgentPanelCollapsed label={panel.label} state={panelState} />;
    }
    return <AgentPanel label={panel.label} state={panelState} />;
  };

  // Single-column layout for narrow terminals
  if (singleColumn) {
    return (
      <Box flexDirection="column">
        {panels.map((panel) => (
          <Box key={panel.id}>{renderPanel(panel)}</Box>
        ))}
      </Box>
    );
  }

  // 2-column grid layout
  const rows: Array<[typeof panels[0], typeof panels[0] | undefined]> = [];
  for (let i = 0; i < panels.length; i += 2) {
    rows.push([panels[i]!, panels[i + 1]]);
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx} flexDirection="row">
          <Box flexGrow={1} flexBasis={0}>
            {renderPanel(row[0])}
          </Box>
          {row[1] && (
            <Box flexGrow={1} flexBasis={0}>
              {renderPanel(row[1])}
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
