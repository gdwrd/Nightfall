import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'gathering'
  | 'ready_to_compile'
  | 'spec_saved'
  | 'plan_saved';

export interface NewProjectSession {
  id: string;
  idea: string;
  history: { role: 'assistant' | 'user'; content: string }[];
  questionCount: number;
  status: SessionStatus;
  specPath: string | null;
  planPath: string | null;
  projectSlug: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a kebab-case slug from the user's idea text.
 * Takes the first few meaningful words, lowercases, and joins with hyphens.
 */
export function deriveSlug(idea: string): string {
  const stop = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'that', 'this', 'it', 'i', 'we', 'my', 'our', 'and', 'or',
  ]);

  const words = idea
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !stop.has(w));

  const slug = words.slice(0, 5).join('-');
  return slug || `project-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

/** Maximum questions before auto-triggering spec compilation. */
export const MAX_QUESTIONS = 20;

export class NewProjectSessionManager {
  private sessions = new Map<string, NewProjectSession>();

  /** Create a new brainstorming session with the given idea. */
  create(idea: string): NewProjectSession {
    const id = randomUUID();
    const session: NewProjectSession = {
      id,
      idea,
      history: [],
      questionCount: 0,
      status: 'gathering',
      specPath: null,
      planPath: null,
      projectSlug: deriveSlug(idea),
    };
    this.sessions.set(id, session);
    return session;
  }

  /** Retrieve an existing session by ID. */
  get(sessionId: string): NewProjectSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Remove a session (cleanup after completion or cancellation). */
  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Check whether any session is currently active. */
  hasActive(): boolean {
    return this.sessions.size > 0;
  }

  /** Return any active session (first in the map), or undefined if none. */
  getAnyActive(): NewProjectSession | undefined {
    return this.sessions.values().next().value;
  }
}
