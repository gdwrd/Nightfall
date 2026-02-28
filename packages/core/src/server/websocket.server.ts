import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type {
  NightfallConfig,
  ProviderAdapter,
  ClientMessage,
  OllamaLifecycleEvent,
} from '@nightfall/shared';
import { TaskOrchestrator } from '../orchestrator/task.orchestrator.js';
import { ensureOllama } from '../ollama/ollama.lifecycle.js';
import { WsBroadcaster } from './ws.broadcaster.js';
import type { PendingApprovalHandle } from './ws.broadcaster.js';

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
 *   - Wires TaskOrchestrator events → WS broadcasts via WsBroadcaster
 *   - Accepts and routes ClientMessages from connected clients
 */
export class NightfallServer extends EventEmitter {
  private readonly wss: WebSocketServer;
  private readonly orchestrator: TaskOrchestrator;
  private readonly broadcaster: WsBroadcaster;
  private readonly config: NightfallConfig;

  /** Handle to the pending plan-approval task ID (managed by WsBroadcaster). */
  private approval: PendingApprovalHandle | null = null;

  /** AbortController for the currently running or planning task. */
  private activeAbortController: AbortController | null = null;

  /** The port this server listens on. */
  readonly port: number;

  constructor(options: NightfallServerOptions) {
    super();
    this.config = options.config;
    this.port = options.port ?? 7171;

    this.wss = new WebSocketServer({ port: this.port });
    this.broadcaster = new WsBroadcaster(this.wss);

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
    this.approval = this.broadcaster.wireOrchestrator(this.orchestrator);
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
  // Ollama lifecycle
  // ---------------------------------------------------------------------------

  private startOllamaLifecycle(): void {
    ensureOllama(this.config, (event: OllamaLifecycleEvent) => {
      this.broadcaster.broadcast({ type: 'LIFECYCLE', payload: event });
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.broadcaster.broadcast({ type: 'LIFECYCLE', payload: { type: 'fatal', message } });
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
        this.broadcaster.send(ws, { type: 'ERROR', payload: { message: 'Invalid JSON message' } });
        return;
      }

      this.handleClientMessage(msg, ws).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.broadcaster.send(ws, { type: 'ERROR', payload: { message } });
      });
    });
  }

  private async handleClientMessage(msg: ClientMessage, ws: WebSocket): Promise<void> {
    switch (msg.type) {
      case 'SUBMIT_TASK': {
        const ac = new AbortController();
        this.activeAbortController = ac;
        this.orchestrator.submitTask(msg.payload.prompt, ac.signal).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.broadcaster.send(ws, { type: 'ERROR', payload: { message } });
        });
        break;
      }

      case 'APPROVE_PLAN': {
        const taskId = this.approval?.getPendingTaskId();
        if (!taskId) {
          this.broadcaster.send(ws, { type: 'ERROR', payload: { message: 'No plan awaiting approval' } });
          return;
        }
        this.approval?.clearPendingTaskId();
        const ac = new AbortController();
        this.activeAbortController = ac;
        this.orchestrator.approvePlan(taskId, ac.signal, msg.payload.editedPlan).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.broadcaster.send(ws, { type: 'ERROR', payload: { message } });
        });
        break;
      }

      case 'REJECT_PLAN': {
        this.approval?.clearPendingTaskId();
        break;
      }

      case 'INTERRUPT': {
        this.activeAbortController?.abort();
        this.activeAbortController = null;
        break;
      }

      case 'SLASH_COMMAND': {
        // Slash commands are handled client-side; echo back so client can confirm receipt
        this.broadcaster.send(ws, {
          type: 'SLASH_RESULT',
          payload: { command: msg.payload.command, output: '' },
        });
        break;
      }
    }
  }
}
