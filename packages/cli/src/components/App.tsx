import React, { useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { NightfallConfig, TaskRun, AgentState, FileLock } from '@nightfall/shared';
import type { OllamaLifecycleEvent } from '@nightfall/shared';
import type { IOrchestrator } from '../ws.client.js';
import { THEME } from '../theme.js';
import { Header } from './Header.js';
import { LifecycleView } from './LifecycleView.js';
import { AgentGrid } from './AgentGrid.js';
import { StatusBar } from './StatusBar.js';
import { PlanView } from './PlanView.js';
import { InputBar } from './InputBar.js';
import type { InputMode } from './InputBar.js';
import { handleSlashCommand } from '../slash.commands.js';
import { useAppStore } from '../store/app.store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppProps {
  config: NightfallConfig;
  orchestrator: IOrchestrator;
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export const App: React.FC<AppProps> = ({ config, orchestrator, projectRoot }) => {
  const { exit } = useApp();
  const [state, dispatch] = useAppStore();
  const { phase, lifecycleEvent, activeRun, agentStates, locks, messages, errorMessage } = state;

  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Ollama lifecycle events ─────────────────────────────────────────────────
  useEffect(() => {
    const onLifecycle = (event: OllamaLifecycleEvent) => {
      dispatch({ type: 'LIFECYCLE_EVENT', event });
    };
    orchestrator.on('lifecycle', onLifecycle);
    return () => { orchestrator.off('lifecycle', onLifecycle); };
  }, [orchestrator, dispatch]);

  // ── Orchestrator event wiring ──────────────────────────────────────────────
  useEffect(() => {
    const onTaskStatus = (run: TaskRun) => {
      dispatch({ type: 'TASK_STATUS', run });
    };
    const onAgentState = (s: AgentState) => {
      dispatch({ type: 'AGENT_STATE', state: s });
    };
    const onLockUpdate = (updated: FileLock[]) => {
      dispatch({ type: 'LOCK_UPDATE', locks: updated });
    };

    orchestrator.on('task:status', onTaskStatus);
    orchestrator.on('agent:state', onAgentState);
    orchestrator.on('lock:update', onLockUpdate);

    return () => {
      orchestrator.off('task:status', onTaskStatus);
      orchestrator.off('agent:state', onAgentState);
      orchestrator.off('lock:update', onLockUpdate);
    };
  }, [orchestrator, dispatch]);

  // ── Keyboard: Ctrl+C ───────────────────────────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (phase === 'running' || phase === 'planning') {
        abortControllerRef.current?.abort();
      } else {
        exit();
      }
    }
  });

  // ── Input handler ──────────────────────────────────────────────────────────
  const handleInput = async (input: string) => {
    const addMessage = (msg: string) => dispatch({ type: 'ADD_MESSAGE', message: msg });

    // Slash commands
    if (input.startsWith('/')) {
      const result = await handleSlashCommand(input, { config, orchestrator, projectRoot, addMessage });
      if (result === 'exit') {
        exit();
        return;
      }
      if (result === '[clear]') {
        dispatch({ type: 'CLEAR_MESSAGES' });
        return;
      }
      if (result) addMessage(result);
      return;
    }

    // Plan approval mode
    if (phase === 'awaiting_approval' && activeRun) {
      const lower = input.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        const ac = new AbortController();
        abortControllerRef.current = ac;
        orchestrator.approvePlan(activeRun.id, ac.signal).catch((err: unknown) => {
          addMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
          dispatch({ type: 'SET_PHASE', phase: 'idle' });
        });
        return;
      }
      if (lower === 'n' || lower === 'no') {
        dispatch({ type: 'SET_PHASE', phase: 'idle' });
        dispatch({ type: 'RESET_TASK' });
        addMessage('Plan rejected. Submit a revised task.');
        return;
      }
      // Treat anything else as a revised task prompt — fall through
    }

    // Submit new task
    if (phase === 'idle' || phase === 'completed' || phase === 'awaiting_approval') {
      dispatch({ type: 'RESET_TASK' });
      const ac = new AbortController();
      abortControllerRef.current = ac;
      orchestrator.submitTask(input, ac.signal).catch((err: unknown) => {
        dispatch({ type: 'ADD_MESSAGE', message: `Error: ${err instanceof Error ? err.message : String(err)}` });
        dispatch({ type: 'SET_PHASE', phase: 'idle' });
      });
    }
  };

  // ── Derive InputBar mode ───────────────────────────────────────────────────
  const inputMode: InputMode =
    phase === 'running' || phase === 'planning'
      ? 'running'
      : phase === 'awaiting_approval'
        ? 'plan_approval'
        : phase === 'completed'
          ? 'completed'
          : 'idle';

  // ── Determine engineer count for grid ─────────────────────────────────────
  const engineerCount = activeRun?.plan?.estimatedEngineers ?? 1;

  // ── Render ─────────────────────────────────────────────────────────────────

  // Fatal error
  if (phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={THEME.error}>Fatal error</Text>
        <Text color={THEME.textDim}>{errorMessage}</Text>
      </Box>
    );
  }

  // Lifecycle startup
  if (phase === 'lifecycle') {
    return <LifecycleView event={lifecycleEvent} />;
  }

  // Main UI
  return (
    <Box flexDirection="column">
      <Header model={config.provider.model} taskStatus={activeRun?.status} />

      {/* Plan approval view */}
      {phase === 'awaiting_approval' && activeRun?.plan && (
        <PlanView plan={activeRun.plan} />
      )}

      {/* Agent panels — visible during execution and after completion */}
      {Object.keys(agentStates).length > 0 &&
        (phase === 'running' || phase === 'planning' || phase === 'completed') && (
          <>
            <AgentGrid agentStates={agentStates} engineerCount={engineerCount} />
            {locks.length > 0 && <StatusBar locks={locks} />}
          </>
        )}

      {/* Message log */}
      {messages.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          {messages.map((msg, i) => (
            <Text key={i} color={messageColor(msg)}>
              {msg}
            </Text>
          ))}
        </Box>
      )}

      <InputBar
        mode={inputMode}
        onSubmit={handleInput}
        completionMessage={messages[messages.length - 1]}
      />
    </Box>
  );
};

function messageColor(msg: string): string {
  if (msg.startsWith('✓')) return THEME.success;
  if (msg.startsWith('⚠') || msg.startsWith('!')) return THEME.warning;
  if (msg.startsWith('Error') || msg.startsWith('Fatal')) return THEME.error;
  return THEME.textDim;
}
