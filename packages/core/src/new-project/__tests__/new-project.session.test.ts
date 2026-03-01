import { describe, it, expect, beforeEach } from 'vitest';
import {
  NewProjectSessionManager,
  deriveSlug,
  MAX_QUESTIONS,
} from '../new-project.session.js';

// ---------------------------------------------------------------------------
// deriveSlug
// ---------------------------------------------------------------------------

describe('deriveSlug', () => {
  it('produces a kebab-case slug from a plain idea', () => {
    expect(deriveSlug('task management app')).toBe('task-management-app');
  });

  it('strips stop words', () => {
    expect(deriveSlug('I want to build a chat app')).toBe('want-build-chat-app');
  });

  it('removes punctuation and special characters', () => {
    expect(deriveSlug('Real-time collaboration tool!!!')).toBe(
      'realtime-collaboration-tool',
    );
  });

  it('limits to 5 words', () => {
    const slug = deriveSlug(
      'very long project idea description that goes on and on',
    );
    const parts = slug.split('-');
    expect(parts.length).toBeLessThanOrEqual(5);
  });

  it('returns a fallback when idea has only stop words', () => {
    const slug = deriveSlug('a the is');
    expect(slug).toMatch(/^project-\d+$/);
  });

  it('returns a fallback for an empty string', () => {
    const slug = deriveSlug('');
    expect(slug).toMatch(/^project-\d+$/);
  });
});

// ---------------------------------------------------------------------------
// NewProjectSessionManager
// ---------------------------------------------------------------------------

describe('NewProjectSessionManager', () => {
  let mgr: NewProjectSessionManager;

  beforeEach(() => {
    mgr = new NewProjectSessionManager();
  });

  // --- create ---

  it('creates a session with a unique ID', () => {
    const s = mgr.create('build a todo app');
    expect(s.id).toBeTruthy();
    expect(typeof s.id).toBe('string');
    expect(s.id.length).toBeGreaterThan(0);
  });

  it('initialises session fields correctly', () => {
    const s = mgr.create('chat application');
    expect(s.idea).toBe('chat application');
    expect(s.history).toEqual([]);
    expect(s.questionCount).toBe(0);
    expect(s.status).toBe('gathering');
    expect(s.specPath).toBeNull();
    expect(s.planPath).toBeNull();
    expect(s.projectSlug).toBe('chat-application');
  });

  it('creates sessions with distinct IDs', () => {
    const s1 = mgr.create('app one');
    const s2 = mgr.create('app two');
    expect(s1.id).not.toBe(s2.id);
  });

  // --- get ---

  it('retrieves an existing session by ID', () => {
    const s = mgr.create('test idea');
    const retrieved = mgr.get(s.id);
    expect(retrieved).toBe(s);
  });

  it('returns undefined for an unknown ID', () => {
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  // --- delete ---

  it('removes a session', () => {
    const s = mgr.create('will be deleted');
    mgr.delete(s.id);
    expect(mgr.get(s.id)).toBeUndefined();
  });

  it('does not throw when deleting a nonexistent session', () => {
    expect(() => mgr.delete('nope')).not.toThrow();
  });

  // --- hasActive ---

  it('reports no active sessions initially', () => {
    expect(mgr.hasActive()).toBe(false);
  });

  it('reports active sessions after create', () => {
    mgr.create('active session');
    expect(mgr.hasActive()).toBe(true);
  });

  it('reports no active sessions after deleting the only one', () => {
    const s = mgr.create('only session');
    mgr.delete(s.id);
    expect(mgr.hasActive()).toBe(false);
  });

  // --- history accumulation ---

  it('allows history to be mutated on the session object', () => {
    const s = mgr.create('mutable history');
    s.history.push({ role: 'assistant', content: 'What is the core problem?' });
    s.history.push({ role: 'user', content: 'Users cannot track tasks.' });

    const retrieved = mgr.get(s.id)!;
    expect(retrieved.history).toHaveLength(2);
    expect(retrieved.history[0].role).toBe('assistant');
    expect(retrieved.history[1].role).toBe('user');
  });

  // --- status transitions ---

  it('allows status transitions on the session object', () => {
    const s = mgr.create('status test');
    expect(s.status).toBe('gathering');

    s.status = 'ready_to_compile';
    expect(mgr.get(s.id)!.status).toBe('ready_to_compile');

    s.status = 'spec_saved';
    expect(mgr.get(s.id)!.status).toBe('spec_saved');

    s.status = 'plan_saved';
    expect(mgr.get(s.id)!.status).toBe('plan_saved');
  });
});

// ---------------------------------------------------------------------------
// MAX_QUESTIONS constant
// ---------------------------------------------------------------------------

describe('MAX_QUESTIONS', () => {
  it('is set to 20', () => {
    expect(MAX_QUESTIONS).toBe(20);
  });
});
