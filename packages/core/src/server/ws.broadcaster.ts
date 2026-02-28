import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMessage, TaskRun, AgentState, FileLock } from '@nightfall/shared';
import type { TaskOrchestrator } from '../orchestrator/task.orchestrator.js';

// ---------------------------------------------------------------------------
// WsBroadcaster
// ---------------------------------------------------------------------------

/**
 * Encapsulates all outgoing WebSocket broadcast logic.
 *
 * Responsibilities:
 * - Broadcast a ServerMessage to every connected client
 * - Send a ServerMessage to a single client
 * - Wire TaskOrchestrator events to broadcasts
 *
 * This separates broadcast concerns from connection/command handling in
 * NightfallServer, making each class independently testable.
 */
export class WsBroadcaster {
  constructor(private readonly wss: WebSocketServer) {}

  // ---------------------------------------------------------------------------
  // Send helpers
  // ---------------------------------------------------------------------------

  /** Send a message to all open clients. */
  broadcast(msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }

  /** Send a message to a single client. */
  send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // ---------------------------------------------------------------------------
  // Orchestrator wiring
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to TaskOrchestrator events and forward them as ServerMessages.
   *
   * Returns a handle for the pending plan-approval task ID, which the server
   * needs to route APPROVE_PLAN commands.
   */
  wireOrchestrator(orchestrator: TaskOrchestrator): PendingApprovalHandle {
    let pendingApprovalTaskId: string | null = null;

    orchestrator.on('task:status', (run: TaskRun) => {
      if (run.status === 'awaiting_approval') {
        pendingApprovalTaskId = run.id;
      } else if (run.status !== 'planning') {
        pendingApprovalTaskId = null;
      }

      this.broadcast({ type: 'TASK_STATE', payload: run });

      if (run.status === 'awaiting_approval' && run.plan) {
        this.broadcast({ type: 'PLAN_READY', payload: run.plan });
      }

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

    orchestrator.on('agent:state', (state: AgentState) => {
      this.broadcast({ type: 'AGENT_UPDATE', payload: state });
    });

    orchestrator.on('lock:update', (locks: FileLock[]) => {
      this.broadcast({ type: 'LOCK_UPDATE', payload: locks });
    });

    return {
      getPendingTaskId: () => pendingApprovalTaskId,
      clearPendingTaskId: () => { pendingApprovalTaskId = null; },
    };
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingApprovalHandle {
  getPendingTaskId(): string | null;
  clearPendingTaskId(): void;
}
