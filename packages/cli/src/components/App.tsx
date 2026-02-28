import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { NightfallConfig, TaskRun, AgentState, FileLock } from '@nightfall/shared';
import { ensureOllama, TaskOrchestrator } from '@nightfall/core';
import type { OllamaLifecycleEvent } from '@nightfall/core';
import { THEME } from '../theme.js';
import { Header } from './Header.js';
import { LifecycleView } from './LifecycleView.js';
import { AgentGrid } from './AgentGrid.js';
import { StatusBar } from './StatusBar.js';
import { PlanView } from './PlanView.js';
import { InputBar } from './InputBar.js';
import type { InputMode } from './InputBar.js';
import { handleSlashCommand } from '../slash.commands.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppPhase =
  | 'lifecycle'    // Ollama startup in progress
  | 'idle'         // Ready for user input
  | 'planning'     // Team Lead is drafting the plan
  | 'awaiting_approval' // Plan ready, waiting for y/n
  | 'running'      // Engineers / reviewer executing
  | 'completed'    // Task finished
  | 'error';       // Fatal error

interface AppProps {
  config: NightfallConfig;
  orchestrator: TaskOrchestrator;
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export const App: React.FC<AppProps> = ({ config, orchestrator, projectRoot }) => {
  const { exit } = useApp();

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<AppPhase>('lifecycle');
  const [lifecycleEvent, setLifecycleEvent] = useState<OllamaLifecycleEvent>({ type: 'detecting' });
  const [activeRun, setActiveRun] = useState<TaskRun | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Ollama lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    ensureOllama(config, (event) => {
      if (cancelled) return;
      setLifecycleEvent(event);
      if (event.type === 'model_ready') {
        setPhase('idle');
      } else if (event.type === 'fatal') {
        setErrorMessage(event.message);
        setPhase('error');
      }
    }).catch((err: unknown) => {
      if (!cancelled) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Orchestrator event wiring ──────────────────────────────────────────────
  useEffect(() => {
    const onTaskStatus = (run: TaskRun) => {
      setActiveRun(run);
      setAgentStates({ ...run.agentStates });

      switch (run.status) {
        case 'planning':
          setPhase('planning');
          break;
        case 'awaiting_approval':
          setPhase('awaiting_approval');
          break;
        case 'running':
        case 'reviewing':
        case 'reworking':
          setPhase('running');
          break;
        case 'completed':
          setPhase('completed');
          addMessage('✓ Task completed successfully.');
          break;
        case 'rework_limit_reached':
          setPhase('completed');
          addMessage('⚠ Rework limit reached. Review the changes manually.');
          break;
        case 'cancelled':
          setPhase('idle');
          addMessage('Task cancelled.');
          break;
      }
    };

    const onAgentState = (state: AgentState) => {
      setAgentStates((prev) => ({ ...prev, [state.id]: state }));
    };

    const onLockUpdate = (updated: FileLock[]) => {
      setLocks(updated);
    };

    orchestrator.on('task:status', onTaskStatus);
    orchestrator.on('agent:state', onAgentState);
    orchestrator.on('lock:update', onLockUpdate);

    return () => {
      orchestrator.off('task:status', onTaskStatus);
      orchestrator.off('agent:state', onAgentState);
      orchestrator.off('lock:update', onLockUpdate);
    };
  }, [orchestrator]);

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

  // ── Helpers ────────────────────────────────────────────────────────────────
  const addMessage = (msg: string) => {
    setMessages((prev) => [...prev.slice(-9), msg]);
  };

  // ── Input handler ──────────────────────────────────────────────────────────
  const handleInput = async (input: string) => {
    // Slash commands
    if (input.startsWith('/')) {
      const result = await handleSlashCommand(input, { config, orchestrator, projectRoot, addMessage });
      if (result === 'exit') {
        exit();
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
          setPhase('idle');
        });
        return;
      }
      if (lower === 'n' || lower === 'no') {
        setPhase('idle');
        setActiveRun(null);
        setAgentStates({});
        addMessage('Plan rejected. Submit a revised task.');
        return;
      }
      // Treat anything else as a revised task prompt — fall through
    }

    // Submit new task
    if (phase === 'idle' || phase === 'completed' || phase === 'awaiting_approval') {
      setAgentStates({});
      setLocks([]);
      const ac = new AbortController();
      abortControllerRef.current = ac;
      orchestrator.submitTask(input, ac.signal).catch((err: unknown) => {
        addMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setPhase('idle');
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

