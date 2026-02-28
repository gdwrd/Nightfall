import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type {
  NightfallConfig,
  ProviderAdapter,
  ClientMessage,
  ServerMessage,
  OllamaLifecycleEvent,
  TaskRun,
  AgentState,
  FileLock,
} from '@nightfall/shared';
import { TaskOrchestrator } from '../orchestrator/task.orchestrator.js';
import { ensureOllama } from '../ollama/ollama.lifecycle.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NightfallServerOptions {
  config: NightfallConfig;
  provider: ProviderAdapter;
  projectRoot: string;
  /** WebSocket port. Defaults to 7171. */
  port?: number;
}

// ---------------------------------------------------------------------------
// NightfallServer
// ---------------------------------------------------------------------------

/**
 * Core WebSocket server that wraps the TaskOrchestrator and Ollama lifecycle.
 *
 * The protocol is defined by ClientMessage / ServerMessage in @nightfall/shared.
 * Any UI (CLI, web, VS Code extension) can connect to this server on localhost
 * without touching the core engine.
 *
 * Lifecycle:
 *   new NightfallServer(options) → server.start() → server.close()
 *
 * On start():
 *   - Opens a WS server on `port`
 *   - Starts Ollama lifecycle (broadcasts LIFECYCLE events)
 *   - Wires TaskOrchestrator events → WS broadcasts
 *   - Accepts and routes ClientMessages from connected clients
 */
export class NightfallServer extends EventEmitter {
  private readonly wss: WebSocketServer;
  private readonly orchestrator: TaskOrchestrator;
  private readonly config: NightfallConfig;

  /** taskId currently awaiting plan approval. */
  private pendingApprovalTaskId: string | null = null;

  /** AbortController for the currently running or planning task. */
  private activeAbortController: AbortController | null = null;

  /** The port this server listens on. */
  readonly port: number;

  constructor(options: NightfallServerOptions) {
    super();
    this.config = options.config;
    this.port = options.port ?? 7171;

    this.wss = new WebSocketServer({ port: this.port });

    this.orchestrator = new TaskOrchestrator({
      config: options.config,
      provider: options.provider,
      projectRoot: options.projectRoot,
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start the server:
   * 1. Wire orchestrator events → WS broadcasts
   * 2. Begin accepting WS connections
   * 3. Start Ollama lifecycle (broadcasts LIFECYCLE messages)
   */
  start(): void {
    this.wireOrchestratorEvents();
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.startOllamaLifecycle();
  }

  /** Gracefully close the WS server. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  // ---------------------------------------------------------------------------
  // Orchestrator event wiring
  // ---------------------------------------------------------------------------

  private wireOrchestratorEvents(): void {
    this.orchestrator.on('task:status', (run: TaskRun) => {
      // Track which task is awaiting plan approval
      if (run.status === 'awaiting_approval') {
        this.pendingApprovalTaskId = run.id;
      } else if (run.status !== 'planning') {
        // Clear once execution begins or task ends
        this.pendingApprovalTaskId = null;
      }

      this.broadcast({ type: 'TASK_STATE', payload: run });

      // Emit dedicated PLAN_READY when plan is produced
      if (run.status === 'awaiting_approval' && run.plan) {
        this.broadcast({ type: 'PLAN_READY', payload: run.plan });
      }

      // Emit TASK_COMPLETE for terminal states
      if (
        run.status === 'completed' ||
        run.status === 'rework_limit_reached' ||
        run.status === 'cancelled'
      ) {
        const summary =
          run.status === 'completed'
            ? 'Task completed successfully.'
            : run.status === 'rework_limit_reached'
              ? 'Rework limit reached. Review changes manually.'
              : 'Task cancelled.';
        this.broadcast({ type: 'TASK_COMPLETE', payload: { status: run.status, summary } });
      }
    });

    this.orchestrator.on('agent:state', (state: AgentState) => {
      this.broadcast({ type: 'AGENT_UPDATE', payload: state });
    });

    this.orchestrator.on('lock:update', (locks: FileLock[]) => {
      this.broadcast({ type: 'LOCK_UPDATE', payload: locks });
    });
  }

  // ---------------------------------------------------------------------------
  // Ollama lifecycle
  // ---------------------------------------------------------------------------

  private startOllamaLifecycle(): void {
    ensureOllama(this.config, (event: OllamaLifecycleEvent) => {
      this.broadcast({ type: 'LIFECYCLE', payload: event });
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.broadcast({ type: 'LIFECYCLE', payload: { type: 'fatal', message } });
    });
  }

  // ---------------------------------------------------------------------------
  // Connection handling
  // ---------------------------------------------------------------------------

  private handleConnection(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        this.send(ws, { type: 'ERROR', payload: { message: 'Invalid JSON message' } });
        return;
      }

      this.handleClientMessage(msg, ws).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.send(ws, { type: 'ERROR', payload: { message } });
      });
    });
  }

  private async handleClientMessage(msg: ClientMessage, ws: WebSocket): Promise<void> {
    switch (msg.type) {
      case 'SUBMIT_TASK': {
        const ac = new AbortController();
        this.activeAbortController = ac;
        // Fire-and-forget: events broadcast via orchestrator listeners
        this.orchestrator.submitTask(msg.payload.prompt, ac.signal).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.send(ws, { type: 'ERROR', payload: { message } });
        });
        break;
      }

      case 'APPROVE_PLAN': {
        if (!this.pendingApprovalTaskId) {
          this.send(ws, { type: 'ERROR', payload: { message: 'No plan awaiting approval' } });
          return;
        }
        const taskId = this.pendingApprovalTaskId;
        this.pendingApprovalTaskId = null;
        const ac = new AbortController();
        this.activeAbortController = ac;
        this.orchestrator.approvePlan(taskId, ac.signal).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.send(ws, { type: 'ERROR', payload: { message } });
        });
        break;
      }

      case 'REJECT_PLAN': {
        // Rejecting a plan: clear the pending approval; no orchestrator call needed
        this.pendingApprovalTaskId = null;
        break;
      }

      case 'INTERRUPT': {
        this.activeAbortController?.abort();
        this.activeAbortController = null;
        break;
      }

      case 'SLASH_COMMAND': {
        // Slash commands are handled client-side; echo back so client can confirm receipt
        this.send(ws, {
          type: 'SLASH_RESULT',
          payload: { command: msg.payload.command, output: '' },
        });
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Broadcast helpers
  // ---------------------------------------------------------------------------

  /** Send a message to all connected clients. */
  private broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }

  /** Send a message to a single client. */
  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
