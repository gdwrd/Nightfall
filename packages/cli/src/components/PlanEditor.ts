import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskPlan } from '@nightfall/shared';

/**
 * Opens the given plan in $EDITOR (or vi as fallback), waits for the user to
 * save and quit, then reads the file back and returns the edited plan.
 *
 * Returns `null` if the plan was not changed, the file could not be parsed, or
 * the editor process failed.
 *
 * Callers must release raw mode on stdin before calling this function and
 * restore it afterward so the external editor can use the terminal normally.
 */
export function editPlanInEditor(plan: TaskPlan): TaskPlan | null {
  const tmpFile = join(tmpdir(), `nightfall-plan-${Date.now()}.json`);
  const original = JSON.stringify(plan, null, 2);
  writeFileSync(tmpFile, original, 'utf-8');

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';

  try {
    execFileSync(editor, [tmpFile], { stdio: 'inherit' });
  } catch {
    cleanup(tmpFile);
    return null;
  }

  try {
    const edited = readFileSync(tmpFile, 'utf-8');
    cleanup(tmpFile);
    if (edited === original) return null; // unchanged
    return JSON.parse(edited) as TaskPlan;
  } catch {
    cleanup(tmpFile);
    return null;
  }
}

function cleanup(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}
