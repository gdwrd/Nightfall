import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type {
  NightfallConfig,
  TaskRun,
  AgentState,
  FileLock,
  SnapshotMeta,
} from '@nightfall/shared';
import type { ProviderLifecycleEvent } from '@nightfall/shared';
import type { IOrchestrator } from '../ws.client.js';
import { THEME } from '../theme.js';
import { Header } from './Header.js';
import { InfoBar } from './InfoBar.js';
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
import { ThinkingPanel } from './ThinkingPanel.js';
import { ModelView } from './ModelView.js';
import { SettingsView } from './SettingsView.js';
import { NewProjectWizard } from './NewProjectWizard.js';
import { ProviderSetupWizard } from './ProviderSetupWizard.js';
import { useAppStore } from '../store/app.store.js';
import type { ModelViewData } from '../store/app.store.js';
import { saveConfig } from '@nightfall/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppProps {
  config: NightfallConfig;
  orchestrator: IOrchestrator;
  projectRoot: string;
  memoryInitialized: boolean;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export const App: React.FC<AppProps> = ({ config, orchestrator, memoryInitialized }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
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
    contextLength,
    modelViewData,
    settingsViewData,
    lastTaskTokens,
  } = state;
  const [inputValue, setInputValue] = useState('');
  const [awaitingInitConfirm, setAwaitingInitConfirm] = useState(false);
  const [memoryBankReady, setMemoryBankReady] = useState(memoryInitialized);

  const abortControllerRef = useRef<AbortController | null>(null);

  const terminalRows = stdout?.rows ?? 24;
  const hasActiveAgents = Object.values(agentStates).some(
    (a) => a.status !== 'done' && a.status !== 'error',
  );
  const isThinking = phase === 'planning' || phase === 'running' || hasActiveAgents;

  // ── Animation: single spinner (only while thinking) ────────────────────────
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  useEffect(() => {
    if (!isThinking) return;
    const id = setInterval(() => setSpinnerFrame((f) => f + 1), 100);
    return () => clearInterval(id);
  }, [isThinking]);

  // ── Animation: clock (always runs, 1 re-render/sec) ───────────────────────
  const [clockTime, setClockTime] = useState(() => formatTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setClockTime(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Provider lifecycle events ──────────────────────────────────────────────
  useEffect(() => {
    const onLifecycle = (event: ProviderLifecycleEvent) => {
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

    const onWsError = (err: Error) => {
      dispatch({ type: 'ADD_MESSAGE', message: `! Connection error: ${err.message}` });
    };

    orchestrator.on('task:status', onTaskStatus);
    orchestrator.on('agent:state', onAgentState);
    orchestrator.on('lock:update', onLockUpdate);
    orchestrator.on('ws:error', onWsError);

    return () => {
      orchestrator.off('task:status', onTaskStatus);
      orchestrator.off('agent:state', onAgentState);
      orchestrator.off('lock:update', onLockUpdate);
      orchestrator.off('ws:error', onWsError);
    };
  }, [orchestrator, dispatch]);

  // ── Slash command result wiring ────────────────────────────────────────────
  useEffect(() => {
    const onSlashResult = (payload: { command: string; output: string }) => {
      // Detect successful /init so the InfoBar updates without restart
      if (payload.command === '/init' && payload.output.startsWith('✓ Memory bank initialized')) {
        setMemoryBankReady(true);
      }

      if (payload.command === '/init' && payload.output.includes('Type y to create or n to cancel.')) {
        setAwaitingInitConfirm(true);
      }

      if (payload.command === '/clear') {
        setAwaitingInitConfirm(false);
        dispatch({ type: 'HISTORY_CLEARED' });
        if (payload.output) {
          dispatch({ type: 'ADD_MESSAGE', message: `✓ ${payload.output}` });
        }
        return;
      }

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

      if (payload.command === '/model' || payload.command === '/settings') {
        try {
          const data = JSON.parse(payload.output) as { type: string; [key: string]: unknown };

          if (data.type === 'model_view') {
            dispatch({
              type: 'SET_MODEL_VIEW',
              data: data as unknown as ModelViewData,
            });
            return;
          }

          if (data.type === 'settings_view') {
            dispatch({
              type: 'SET_SETTINGS_VIEW',
              data: { config: data.config as NightfallConfig },
            });
            return;
          }

          if (data.type === 'model_saved') {
            dispatch({
              type: 'SET_SLASH_OUTPUT',
              output: `✓ Model changed to ${String(data.model)}. Restart to apply.`,
            });
            dispatch({ type: 'SET_PHASE', phase: 'idle' });
            return;
          }

          if (data.type === 'settings_saved') {
            dispatch({
              type: 'SET_SLASH_OUTPUT',
              output: '✓ Settings saved. Restart Nightfall to apply changes.',
            });
            dispatch({ type: 'SET_PHASE', phase: 'idle' });
            return;
          }

          if (data.type === 'error') {
            dispatch({ type: 'SET_SLASH_OUTPUT', output: `Error: ${String(data.message)}` });
            dispatch({ type: 'SET_PHASE', phase: 'idle' });
            return;
          }
        } catch {
          // Not JSON — fall through to plain text output
        }
      }

      if (payload.command === '/new-project') {
        try {
          const data = JSON.parse(payload.output) as { type: string; [key: string]: unknown };

          switch (data.type) {
            case 'new_project_ask_idea':
              dispatch({
                type: 'SET_NEW_PROJECT',
                data: {
                  sessionId: '', // No session yet — will be set when start responds
                  status: 'asking_idea',
                  currentQuestion:
                    'What would you like to build? Describe your idea in a few sentences.',
                  questionNumber: 0,
                  history: [],
                },
              });
              return;

            case 'new_project_question':
              // Natural language trigger: `idea` field is present — set up
              // fresh wizard state including the user's original prompt.
              if (data.idea) {
                dispatch({
                  type: 'SET_NEW_PROJECT',
                  data: {
                    sessionId: data.sessionId as string,
                    status: 'gathering',
                    currentQuestion: data.question as string,
                    questionNumber: data.questionNumber as number,
                    history: [
                      {
                        role: 'assistant' as const,
                        content: 'What would you like to build? Describe your idea.',
                      },
                      { role: 'user' as const, content: data.idea as string },
                    ],
                  },
                });
                dispatch({
                  type: 'APPEND_NEW_PROJECT_HISTORY',
                  entry: { role: 'assistant' as const, content: data.question as string },
                });
              } else {
                dispatch({
                  type: 'UPDATE_NEW_PROJECT',
                  partial: {
                    sessionId: data.sessionId as string,
                    status: 'gathering',
                    currentQuestion: data.question as string,
                    questionNumber: data.questionNumber as number,
                  },
                });
                dispatch({
                  type: 'APPEND_NEW_PROJECT_HISTORY',
                  entry: { role: 'assistant' as const, content: data.question as string },
                });
              }
              return;

            case 'new_project_gathering_complete':
              dispatch({
                type: 'UPDATE_NEW_PROJECT',
                partial: { status: 'compiling_spec', currentQuestion: null },
              });
              orchestrator.sendSlashCommand(
                '/new-project',
                `generate-spec ${data.sessionId as string}`,
              );
              return;

            case 'new_project_spec_saved':
              dispatch({
                type: 'UPDATE_NEW_PROJECT',
                partial: { status: 'asking_plan' },
              });
              return;

            case 'new_project_plan_saved':
              dispatch({ type: 'CLEAR_NEW_PROJECT' });
              dispatch({
                type: 'SET_SLASH_OUTPUT',
                output: `✓ Project spec and plan saved!\n  Spec: ${data.specPath as string}\n  Plan: ${data.planPath as string}`,
              });
              return;

            case 'new_project_done':
              dispatch({ type: 'CLEAR_NEW_PROJECT' });
              dispatch({
                type: 'SET_SLASH_OUTPUT',
                output: (data.specPath as string | undefined)
                  ? `✓ Project spec saved to ${data.specPath as string}`
                  : 'New project wizard cancelled.',
              });
              return;

            case 'new_project_error':
              dispatch({ type: 'CLEAR_NEW_PROJECT' });
              dispatch({ type: 'SET_SLASH_OUTPUT', output: `Error: ${data.message as string}` });
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
      } else if (phase === 'new_project') {
        const sid = state.newProjectData?.sessionId;
        // Always send cancel — use bare `cancel` when sessionId is unknown
        // (e.g. during the race between sending `start` and receiving the
        // response). The server's handleCancel supports bare cancel via
        // getAnyActive().
        orchestrator.sendSlashCommand('/new-project', sid ? `cancel ${sid}` : 'cancel');
        dispatch({ type: 'CLEAR_NEW_PROJECT' });
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

    // New project wizard mode
    if (phase === 'new_project' && state.newProjectData) {
      const { sessionId, status } = state.newProjectData;

      if (input.toLowerCase() === '/cancel') {
        orchestrator.sendSlashCommand('/new-project', `cancel ${sessionId}`);
        return;
      }

      if (status === 'asking_idea') {
        dispatch({
          type: 'UPDATE_NEW_PROJECT',
          partial: {
            status: 'gathering',
            history: [
              { role: 'assistant' as const, content: state.newProjectData.currentQuestion! },
              { role: 'user' as const, content: input },
            ],
          },
        });
        orchestrator.sendSlashCommand('/new-project', `start ${input}`);
        return;
      }

      if (status === 'gathering') {
        if (input.toLowerCase() === '/done') {
          // Don't optimistically set status to 'compiling_spec' here — let the
          // server response ('new_project_gathering_complete') drive the
          // transition. Otherwise a server-side error (e.g. "no answers yet")
          // causes a brief spinner flash before the error clears the wizard.
          orchestrator.sendSlashCommand('/new-project', `done ${sessionId}`);
          return;
        }
        dispatch({
          type: 'UPDATE_NEW_PROJECT',
          partial: {
            history: [...state.newProjectData.history, { role: 'user' as const, content: input }],
          },
        });
        orchestrator.sendSlashCommand('/new-project', `answer ${sessionId} ${input}`);
        return;
      }

      if (status === 'asking_plan') {
        const lower = input.toLowerCase();
        if (lower === 'y' || lower === 'yes') {
          dispatch({
            type: 'UPDATE_NEW_PROJECT',
            partial: { status: 'compiling_plan' },
          });
          orchestrator.sendSlashCommand('/new-project', `generate-plan ${sessionId}`);
        } else {
          orchestrator.sendSlashCommand('/new-project', `cancel ${sessionId}`);
        }
        return;
      }

      return; // Swallow input during compiling states
    }

    // Slash commands
    if (input.startsWith('/')) {
      const lower = input.trim().toLowerCase();

      // Handle exit locally — no server round-trip needed
      if (lower === '/exit' || lower === '/quit') {
        exit();
        return;
      }

      // Clear any stale slash output before sending the new command
      dispatch({ type: 'SET_SLASH_OUTPUT', output: null });

      // Parse command and optional args
      const [cmd = '', ...rest] = input.trim().split(/\s+/);
      const args = rest.join(' ');

      // Show a loading hint for commands that may take a moment
      if (cmd === '/model') {
        dispatch({ type: 'SET_SLASH_OUTPUT', output: 'Fetching available models...' });
      }

      // Route to server — result arrives via 'slash:result' event
      orchestrator.sendSlashCommand(cmd, args);

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
          void (async () => {
            process.stdin.setRawMode?.(false);
            const result = await editPlanInEditor(activeRun.plan!);
            process.stdin.setRawMode?.(true);
            switch (result.kind) {
              case 'changed':
                dispatch({ type: 'UPDATE_PLAN', plan: result.plan });
                addMessage('Plan updated from editor.');
                dispatch({ type: 'SET_PHASE', phase: 'awaiting_approval' });
                break;
              case 'unchanged':
                addMessage('No changes made.');
                dispatch({ type: 'SET_PHASE', phase: 'awaiting_approval' });
                break;
              case 'failed':
                dispatch({ type: 'PLAN_EDIT_FAILED', message: result.message });
                break;
            }
          })();
        }, 50);
        return;
      }
      // Treat anything else as a revised task prompt — fall through
    }

    // Submit new task
    if (
      phase === 'idle' ||
      phase === 'completed' ||
      phase === 'answered' ||
      phase === 'awaiting_approval'
    ) {
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
    : phase === 'new_project' && state.newProjectData?.status === 'asking_plan'
      ? 'new_project_plan'
      : phase === 'new_project'
        ? 'new_project'
        : phase === 'running' ||
            phase === 'planning' ||
            phase === 'editing_plan' ||
            phase === 'classifying'
          ? 'running'
          : phase === 'awaiting_approval'
            ? 'plan_approval'
            : phase === 'completed'
              ? 'completed'
              : 'idle';

  // ── Determine engineer count for grid ─────────────────────────────────────
  const engineerCount = activeRun?.plan?.estimatedEngineers ?? 1;

  // ── Render ─────────────────────────────────────────────────────────────────

  // Provider setup wizard (shown when provider lifecycle fails fatally)
  if (phase === 'provider_setup') {
    return (
      <ProviderSetupWizard
        errorMessage={state.providerSetupError ?? ''}
        onComplete={(providerConfig) => {
          void saveConfig({ ...config, provider: providerConfig });
          dispatch({ type: 'SET_PHASE', phase: 'lifecycle' });
          orchestrator.reconfigure(providerConfig);
        }}
      />
    );
  }

  // Fatal error (fallback — normally fatal events transition to provider_setup)
  if (phase === 'error') {
    return (
      <Box flexDirection="column" height={terminalRows} padding={1}>
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
      <Box flexDirection="column" height={terminalRows} padding={1}>
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

  // Model picker
  if (phase === 'model_view' && modelViewData) {
    return (
      <ModelView
        provider={modelViewData.provider}
        currentModel={modelViewData.currentModel}
        models={modelViewData.models}
        onSelect={(modelId) => {
          orchestrator.sendSlashCommand('/model', `select ${modelId}`);
        }}
        onExit={() => {
          dispatch({ type: 'SET_PHASE', phase: 'idle' });
          dispatch({ type: 'SET_SLASH_OUTPUT', output: null });
        }}
      />
    );
  }

  // Settings editor
  if (phase === 'settings_view' && settingsViewData) {
    return (
      <SettingsView
        initialConfig={settingsViewData.config}
        onSave={(newConfig) => {
          orchestrator.sendSlashCommand('/settings', `save ${JSON.stringify(newConfig)}`);
        }}
        onExit={() => {
          dispatch({ type: 'SET_PHASE', phase: 'idle' });
          dispatch({ type: 'SET_SLASH_OUTPUT', output: null });
        }}
      />
    );
  }

  // New project wizard
  if (phase === 'new_project' && state.newProjectData) {
    return (
      <NewProjectWizard
        data={state.newProjectData}
        onAnswer={(answer) => handleInput(answer)}
        onDone={() => handleInput('/done')}
        onCancel={() => handleInput('/cancel')}
        onConfirmPlan={(yes) => handleInput(yes ? 'y' : 'n')}
      />
    );
  }

  // Main UI
  return (
    <Box flexDirection="column" height={terminalRows}>
      <Header
        model={config.provider.model}
        taskStatus={activeRun?.status}
        isThinking={isThinking}
        spinnerFrame={spinnerFrame}
        clockTime={clockTime}
      />
      <InfoBar
        provider={config.provider}
        memoryInitialized={memoryBankReady}
        contextLength={contextLength}
      />

      {/* Scrollable content area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {/* Plan approval view */}
        {phase === 'awaiting_approval' && activeRun?.plan && <PlanReview plan={activeRun.plan} />}

        {/* Agent panels — visible during execution and after completion */}
        {Object.keys(agentStates).length > 0 &&
          (phase === 'running' || phase === 'planning' || phase === 'completed') && (
            <>
              <AgentGrid agentStates={agentStates} engineerCount={engineerCount} />
              {(locks.length > 0 || lastTaskTokens) && (
                <StatusBar locks={locks} lastTaskTokens={lastTaskTokens} />
              )}
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
      </Box>

      {/* Thinking panel — shown while model is active */}
      {isThinking && <ThinkingPanel agentStates={agentStates} spinnerFrame={spinnerFrame} />}

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

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour12: false });
}
