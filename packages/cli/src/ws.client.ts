import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import type {
  ClientMessage,
  ServerMessage,
  ProviderLifecycleEvent,
  TaskRun,
  TaskPlan,
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
  on(event: 'lifecycle', listener: (event: ProviderLifecycleEvent) => void): this;
  on(
    event: 'slash:result',
    listener: (payload: { command: string; output: string }) => void,
  ): this;
  on(event: 'ws:error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;

  off(event: 'task:status', listener: (run: TaskRun) => void): this;
  off(event: 'agent:state', listener: (state: AgentState) => void): this;
  off(event: 'lock:update', listener: (locks: FileLock[]) => void): this;
  off(event: 'lifecycle', listener: (event: ProviderLifecycleEvent) => void): this;
  off(
    event: 'slash:result',
    listener: (payload: { command: string; output: string }) => void,
  ): this;
  off(event: 'ws:error', listener: (err: Error) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;

  submitTask(prompt: string, signal?: AbortSignal): Promise<TaskRun>;
  approvePlan(taskId: string, signal?: AbortSignal, editedPlan?: TaskPlan): Promise<TaskRun>;
  getLocks(): FileLock[];
  sendSlashCommand(command: string, args: string): void;
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

  // Reconnection state
  private _reconnectAttempt = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 4;
  private readonly RECONNECT_BASE_MS = 2000;
  private _isReconnecting = false;

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
        this._reconnectAttempt = 0;
        this._isReconnecting = false;

        this.ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as ServerMessage;
            this.handleServerMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        });

        this.ws.on('error', (err) => {
          this.emit('ws:error', err);
        });

        this.ws.on('close', (code) => {
          // Only reconnect on abnormal closure (not intentional close with code 1000)
          if (code !== 1000) {
            this.scheduleReconnect();
          }
        });

        resolve();
      });

      this.ws.once('error', reject);
    });
  }

  /** Close the WebSocket connection. */
  close(): void {
    // Prevent reconnect loop from firing after intentional close
    this._reconnectAttempt = this.MAX_RECONNECT_ATTEMPTS;
    this.ws?.close(1000);
  }

  // ---------------------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------------------

  /** Schedule a reconnect attempt with exponential backoff (2s, 4s, 8s, 16s). */
  private scheduleReconnect(): void {
    if (this._isReconnecting) return; // Prevent concurrent reconnect loops
    if (this._reconnectAttempt >= this.MAX_RECONNECT_ATTEMPTS) {
      this.emit(
        'ws:error',
        new Error('WebSocket disconnected; max reconnect attempts reached'),
      );
      return;
    }
    this._isReconnecting = true;
    this._reconnectAttempt++;
    const delayMs = this.RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt - 1);
    // sequence: 2000ms, 4000ms, 8000ms, 16000ms
    this.emit(
      'ws:error',
      new Error(
        `WebSocket disconnected. Reconnecting in ${delayMs / 1000}s ` +
        `(attempt ${this._reconnectAttempt}/${this.MAX_RECONNECT_ATTEMPTS})...`,
      ),
    );
    setTimeout(() => {
      this.connect()
        .then(() => {
          this._isReconnecting = false;
        })
        .catch(() => {
          this._isReconnecting = false;
          this.scheduleReconnect();
        });
    }, delayMs);
  }

  // ---------------------------------------------------------------------------
  // IOrchestrator methods
  // ---------------------------------------------------------------------------

  /**
   * Submit a task to the server.
   * Resolves once the server reaches `planning` or `awaiting_approval` state.
   * Rejects if a `ws:error` event fires before the expected status arrives.
   */
  submitTask(prompt: string, signal?: AbortSignal): Promise<TaskRun> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const cleanup = () => {
        this.off('task:status', onStatus);
        this.off('ws:error', onWsError);
        signal?.removeEventListener('abort', onAbort);
      };

      const onStatus = (run: TaskRun) => {
        if (
          run.status === 'planning' ||
          run.status === 'awaiting_approval' ||
          run.status === 'answered' ||
          run.status === 'cancelled'
        ) {
          cleanup();
          resolve(run);
        }
      };

      const onWsError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onAbort = () => {
        cleanup();
        this.send({ type: 'INTERRUPT', payload: {} });
        reject(new Error('Aborted'));
      };

      this.on('task:status', onStatus);
      this.on('ws:error', onWsError);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.send({ type: 'SUBMIT_TASK', payload: { prompt } });
    });
  }

  /**
   * Approve the pending plan and begin task execution.
   * Resolves when the task reaches a terminal state.
   * Rejects if a `ws:error` event fires before the task completes.
   */
  approvePlan(_taskId: string, signal?: AbortSignal, editedPlan?: TaskPlan): Promise<TaskRun> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const cleanup = () => {
        this.off('task:status', onStatus);
        this.off('ws:error', onWsError);
        signal?.removeEventListener('abort', onAbort);
      };

      const onStatus = (run: TaskRun) => {
        if (
          run.status === 'completed' ||
          run.status === 'rework_limit_reached' ||
          run.status === 'cancelled'
        ) {
          cleanup();
          resolve(run);
        }
      };

      const onWsError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onAbort = () => {
        cleanup();
        this.send({ type: 'INTERRUPT', payload: {} });
        reject(new Error('Aborted'));
      };

      this.on('task:status', onStatus);
      this.on('ws:error', onWsError);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.send({ type: 'APPROVE_PLAN', payload: editedPlan ? { editedPlan } : {} });
    });
  }

  /** Return the current set of held file locks (maintained from LOCK_UPDATE messages). */
  getLocks(): FileLock[] {
    return this._locks;
  }

  /** Send a slash command to the server for server-side processing. */
  sendSlashCommand(command: string, args: string): void {
    this.send({ type: 'SLASH_COMMAND', payload: { command, args } });
  }

  // ---------------------------------------------------------------------------
  // Inbound message routing
  // ---------------------------------------------------------------------------

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'LIFECYCLE':
        this.emit('lifecycle', msg.payload as ProviderLifecycleEvent);
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
        // Emit as 'ws:error' rather than 'error' to avoid Node.js unhandled-error
        // crash when no listener is attached (#10)
        this.emit('ws:error', new Error((msg.payload as { message: string }).message));
        break;

      case 'SLASH_RESULT':
        this.emit('slash:result', msg.payload);
        break;

      // PLAN_READY, TASK_COMPLETE: handled via TASK_STATE events
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
    } else {
      // Emit ws:error so callers (submitTask, approvePlan) can reject their promises
      this.emit(
        'ws:error',
        new Error(
          `Cannot send ${msg.type}: WebSocket not open (readyState=${this.ws?.readyState ?? -1})`,
        ),
      );
    }
  }
}
