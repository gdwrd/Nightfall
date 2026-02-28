import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { NightfallConfig, TaskRun, AgentState, FileLock, SnapshotMeta } from '@nightfall/shared';
import type { OllamaLifecycleEvent } from '@nightfall/shared';
import type { IOrchestrator } from '../ws.client.js';
import { THEME } from '../theme.js';
import { Header } from './Header.js';
import { LifecycleView } from './LifecycleView.js';
import { AgentGrid } from './AgentGrid.js';
import { StatusBar } from './StatusBar.js';
import { PlanReview } from './PlanReview.js';
import { InputBar } from './InputBar.js';
import type { InputMode } from './InputBar.js';
import { editPlanInEditor } from './PlanEditor.js';
import { SlashOutput } from './SlashOutput.js';
import { SlashAutocomplete } from './SlashAutocomplete.js';
import { HistoryView } from './HistoryView.js';
import { RollbackConfirm } from './RollbackConfirm.js';
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

export const App: React.FC<AppProps> = ({ config, orchestrator }) => {
  const { exit } = useApp();
  const [state, dispatch] = useAppStore();
  const {
    phase,
    lifecycleEvent,
    activeRun,
    agentStates,
    locks,
    messages,
    errorMessage,
    slashOutput,
    historyRuns,
    historySnapshots,
    rollbackChain,
    pendingRollbackSnapshotId,
  } = state;
  const [inputValue, setInputValue] = useState('');
  const [awaitingInitConfirm, setAwaitingInitConfirm] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Ollama lifecycle events ─────────────────────────────────────────────────
  useEffect(() => {
    const onLifecycle = (event: OllamaLifecycleEvent) => {
      dispatch({ type: 'LIFECYCLE_EVENT', event });
    };
    orchestrator.on('lifecycle', onLifecycle);
    return () => {
      orchestrator.off('lifecycle', onLifecycle);
    };
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

  // ── Slash command result wiring ────────────────────────────────────────────
  useEffect(() => {
    const onSlashResult = (payload: { command: string; output: string }) => {
      if (payload.command === '/history') {
        try {
          const data = JSON.parse(payload.output) as { type: string; [key: string]: unknown };
          if (data.type === 'history_view') {
            dispatch({
              type: 'SET_HISTORY_DATA',
              runs: data.runs as TaskRun[],
              snapshots: data.snapshots as SnapshotMeta[],
            });
            return;
          }
          if (data.type === 'rollback_confirm') {
            dispatch({
              type: 'SET_ROLLBACK_CHAIN',
              chain: data.chain as SnapshotMeta[],
              snapshotId: data.snapshotId as string,
            });
            return;
          }
        } catch {
          // Not JSON — fall through to plain text output
        }
      }
      dispatch({ type: 'SET_SLASH_OUTPUT', output: payload.output });
    };
    orchestrator.on('slash:result', onSlashResult);
    return () => {
      orchestrator.off('slash:result', onSlashResult);
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
  const handleInput = (input: string) => {
    const addMessage = (msg: string) => dispatch({ type: 'ADD_MESSAGE', message: msg });

    // /init confirmation prompt
    if (awaitingInitConfirm) {
      const lower = input.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        setAwaitingInitConfirm(false);
        orchestrator.sendSlashCommand('/init', 'confirm');
      } else if (lower === 'n' || lower === 'no') {
        setAwaitingInitConfirm(false);
        dispatch({ type: 'SET_SLASH_OUTPUT', output: 'Cancelled.' });
      }
      return;
    }

    // Slash commands
    if (input.startsWith('/')) {
      const lower = input.trim().toLowerCase();

      // Handle exit locally — no server round-trip needed
      if (lower === '/exit' || lower === '/quit') {
        exit();
        return;
      }

      // Handle clear locally — resets CLI state only
      if (lower === '/clear') {
        setAwaitingInitConfirm(false);
        dispatch({ type: 'CLEAR_MESSAGES' });
        dispatch({ type: 'SET_SLASH_OUTPUT', output: null });
        return;
      }

      // Clear any stale slash output before sending the new command
      dispatch({ type: 'SET_SLASH_OUTPUT', output: null });

      // Parse command and optional args
      const [cmd = '', ...rest] = input.trim().split(/\s+/);
      const args = rest.join(' ');

      // Route to server — result arrives via 'slash:result' event
      orchestrator.sendSlashCommand(cmd, args);

      // Track init preview awaiting confirmation
      if (cmd === '/init' && args === '') {
        setAwaitingInitConfirm(true);
      }

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
      if (lower === 'e' || lower === 'edit') {
        if (!activeRun.plan) return;
        dispatch({ type: 'SET_PHASE', phase: 'editing_plan' });
        // Defer so ink can release the terminal before spawning the editor
        setTimeout(() => {
          process.stdin.setRawMode?.(false);
          const edited = editPlanInEditor(activeRun.plan!);
          process.stdin.setRawMode?.(true);
          if (edited) {
            dispatch({ type: 'UPDATE_PLAN', plan: edited });
            addMessage('Plan updated from editor.');
          } else {
            addMessage('No changes made.');
          }
          dispatch({ type: 'SET_PHASE', phase: 'awaiting_approval' });
        }, 50);
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
        dispatch({
          type: 'ADD_MESSAGE',
          message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
        dispatch({ type: 'SET_PHASE', phase: 'idle' });
      });
    }
  };

  // ── Derive InputBar mode ───────────────────────────────────────────────────
  const inputMode: InputMode = awaitingInitConfirm
    ? 'init_confirm'
    : phase === 'running' || phase === 'planning' || phase === 'editing_plan'
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
        <Text bold color={THEME.error}>
          Fatal error
        </Text>
        <Text color={THEME.textDim}>{errorMessage}</Text>
      </Box>
    );
  }

  // Lifecycle startup
  if (phase === 'lifecycle') {
    return <LifecycleView event={lifecycleEvent} />;
  }

  // Editor is open — show minimal UI
  if (phase === 'editing_plan') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={THEME.primary}>Opening plan in editor...</Text>
      </Box>
    );
  }

  // History browser
  if (phase === 'history_view') {
    return (
      <HistoryView
        runs={historyRuns}
        snapshots={historySnapshots}
        onRollbackRequest={(snapshotId) => {
          orchestrator.sendSlashCommand('/history', `rollback ${snapshotId}`);
        }}
        onExit={() => {
          dispatch({ type: 'SET_PHASE', phase: 'idle' });
          dispatch({ type: 'SET_SLASH_OUTPUT', output: null });
        }}
      />
    );
  }

  // Rollback cascade confirmation
  if (phase === 'rollback_confirm') {
    return (
      <RollbackConfirm
        chain={rollbackChain}
        snapshotId={pendingRollbackSnapshotId ?? ''}
        onConfirm={() => {
          orchestrator.sendSlashCommand(
            '/history',
            `rollback ${pendingRollbackSnapshotId} confirm`,
          );
          dispatch({ type: 'SET_PHASE', phase: 'idle' });
        }}
        onCancel={() => {
          dispatch({ type: 'SET_PHASE', phase: 'history_view' });
        }}
      />
    );
  }

  // Main UI
  return (
    <Box flexDirection="column">
      <Header model={config.provider.model} taskStatus={activeRun?.status} />

      {/* Plan approval view */}
      {phase === 'awaiting_approval' && activeRun?.plan && <PlanReview plan={activeRun.plan} />}

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

      {/* Slash command output */}
      {slashOutput !== null && slashOutput !== '' && <SlashOutput output={slashOutput} />}

      {/* Slash autocomplete — shown above the input bar while typing */}
      <SlashAutocomplete input={inputValue} />

      <InputBar
        mode={inputMode}
        onSubmit={handleInput}
        onValueChange={setInputValue}
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
