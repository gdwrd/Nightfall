import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import type {
  ClientMessage,
  ServerMessage,
  OllamaLifecycleEvent,
  TaskRun,
  AgentState,
  FileLock,
} from '@nightfall/shared';

// ---------------------------------------------------------------------------
// IOrchestrator — shared interface used by App and slash commands
// ---------------------------------------------------------------------------

/**
 * Minimal interface that both TaskOrchestrator (direct) and NightfallWsClient
 * (WebSocket) satisfy.  App.tsx and slash commands depend only on this type.
 */
export interface IOrchestrator extends EventEmitter {
  on(event: 'task:status', listener: (run: TaskRun) => void): this;
  on(event: 'agent:state', listener: (state: AgentState) => void): this;
  on(event: 'lock:update', listener: (locks: FileLock[]) => void): this;
  on(event: 'lifecycle', listener: (event: OllamaLifecycleEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;

  off(event: 'task:status', listener: (run: TaskRun) => void): this;
  off(event: 'agent:state', listener: (state: AgentState) => void): this;
  off(event: 'lock:update', listener: (locks: FileLock[]) => void): this;
  off(event: 'lifecycle', listener: (event: OllamaLifecycleEvent) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;

  submitTask(prompt: string, signal?: AbortSignal): Promise<TaskRun>;
  approvePlan(taskId: string, signal?: AbortSignal): Promise<TaskRun>;
  getLocks(): FileLock[];
}

// ---------------------------------------------------------------------------
// NightfallWsClient
// ---------------------------------------------------------------------------

/**
 * WebSocket client adapter for the NightfallServer.
 *
 * Translates WS ServerMessages → EventEmitter events and provides the same
 * async method API as TaskOrchestrator, making it a drop-in replacement in
 * App.tsx when running with the WS architecture.
 *
 * Usage:
 *   const client = new NightfallWsClient('ws://localhost:7171');
 *   await client.connect();
 *   // lifecycle, task:status, agent:state, lock:update events now flow through
 */
export class NightfallWsClient extends EventEmitter implements IOrchestrator {
  private ws!: WebSocket;
  private _locks: FileLock[] = [];

  constructor(private readonly url: string) {
    super();
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /** Open the WebSocket connection. Resolves when the connection is established. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.once('open', () => {
        this.ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as ServerMessage;
            this.handleServerMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        });

        this.ws.on('error', (err) => {
          this.emit('error', err);
        });

        resolve();
      });

      this.ws.once('error', reject);
    });
  }

  /** Close the WebSocket connection. */
  close(): void {
    this.ws?.close();
  }

  // ---------------------------------------------------------------------------
  // IOrchestrator methods
  // ---------------------------------------------------------------------------

  /**
   * Submit a task to the server.
   * Resolves once the server reaches `planning` or `awaiting_approval` state.
   */
  submitTask(prompt: string, signal?: AbortSignal): Promise<TaskRun> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const onStatus = (run: TaskRun) => {
        if (run.status === 'planning' || run.status === 'awaiting_approval') {
          this.off('task:status', onStatus);
          resolve(run);
        }
      };

      const onAbort = () => {
        this.off('task:status', onStatus);
        this.send({ type: 'INTERRUPT', payload: {} });
        reject(new Error('Aborted'));
      };

      this.on('task:status', onStatus);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.send({ type: 'SUBMIT_TASK', payload: { prompt } });
    });
  }

  /**
   * Approve the pending plan and begin task execution.
   * Resolves when the task reaches a terminal state.
   */
  approvePlan(_taskId: string, signal?: AbortSignal): Promise<TaskRun> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const onStatus = (run: TaskRun) => {
        if (
          run.status === 'completed' ||
          run.status === 'rework_limit_reached' ||
          run.status === 'cancelled'
        ) {
          this.off('task:status', onStatus);
          resolve(run);
        }
      };

      const onAbort = () => {
        this.off('task:status', onStatus);
        this.send({ type: 'INTERRUPT', payload: {} });
        reject(new Error('Aborted'));
      };

      this.on('task:status', onStatus);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.send({ type: 'APPROVE_PLAN', payload: {} });
    });
  }

  /** Return the current set of held file locks (maintained from LOCK_UPDATE messages). */
  getLocks(): FileLock[] {
    return this._locks;
  }

  // ---------------------------------------------------------------------------
  // Inbound message routing
  // ---------------------------------------------------------------------------

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'LIFECYCLE':
        this.emit('lifecycle', msg.payload as OllamaLifecycleEvent);
        break;

      case 'TASK_STATE':
        this.emit('task:status', msg.payload as TaskRun);
        break;

      case 'AGENT_UPDATE':
        this.emit('agent:state', msg.payload as AgentState);
        break;

      case 'LOCK_UPDATE':
        this._locks = msg.payload as FileLock[];
        this.emit('lock:update', this._locks);
        break;

      case 'ERROR':
        this.emit('error', new Error(msg.payload.message));
        break;

      // PLAN_READY, TASK_COMPLETE, SLASH_RESULT: handled via TASK_STATE events
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Send helper
  // ---------------------------------------------------------------------------

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
