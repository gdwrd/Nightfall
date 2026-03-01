import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskPlan } from '@nightfall/shared';

export type EditPlanResult =
  | { kind: 'changed'; plan: TaskPlan }
  | { kind: 'unchanged' }
  | { kind: 'failed'; message: string };

const EDITOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Opens the given plan in $EDITOR (falls back to nano, then vi), waits for
 * the user to save and quit, then reads the file back and returns the result.
 *
 * - Returns `{ kind: 'changed', plan }` if the plan was modified.
 * - Returns `{ kind: 'unchanged' }` if the file was not changed or the editor
 *   exited with a non-zero code.
 * - Returns `{ kind: 'failed', message }` if no editor is available, the
 *   process could not be spawned, or the 5-minute timeout expired.
 *
 * Callers must release raw mode on stdin before calling this function and
 * restore it afterward so the external editor can use the terminal normally.
 */
export async function editPlanInEditor(plan: TaskPlan): Promise<EditPlanResult> {
  const editor = resolveEditor();
  if (!editor) {
    return {
      kind: 'failed',
      message: 'No editor found. Set the $EDITOR environment variable, or install nano or vi.',
    };
  }

  const tmpFile = join(tmpdir(), `nightfall-plan-${Date.now()}.json`);
  const original = JSON.stringify(plan, null, 2);
  writeFileSync(tmpFile, original, 'utf-8');

  try {
    let exitCode: number;
    try {
      exitCode = await runEditor(editor, tmpFile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { kind: 'failed', message: msg };
    }

    if (exitCode !== 0) {
      // Non-zero exit: return original plan unchanged
      return { kind: 'unchanged' };
    }

    const edited = readFileSync(tmpFile, 'utf-8');
    if (edited === original) return { kind: 'unchanged' };

    let parsedPlan: TaskPlan;
    try {
      parsedPlan = JSON.parse(edited) as TaskPlan;
    } catch (_err) {
      return { kind: 'failed', message: 'Edited plan is not valid JSON. Original plan preserved.' };
    }

    return { kind: 'changed', plan: parsedPlan };
  } finally {
    cleanup(tmpFile);
  }
}

function resolveEditor(): { bin: string; args: string[] } | null {
  const explicit = process.env.EDITOR ?? process.env.VISUAL;
  if (explicit) {
    const parts = explicit.trim().split(/\s+/);
    return { bin: parts[0]!, args: parts.slice(1) };
  }

  for (const fallback of ['nano', 'vi']) {
    try {
      execFileSync('which', [fallback], { stdio: 'pipe' });
      return { bin: fallback, args: [] };
    } catch {
      // not found
    }
  }
  return null;
}

function runEditor(editor: { bin: string; args: string[] }, file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(editor.bin, [...editor.args, file], { stdio: 'inherit' });
    } catch (err) {
      reject(
        new Error(
          `Failed to launch editor "${editor.bin}": ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Editor timed out after 5 minutes. Plan unchanged.'));
    }, EDITOR_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to open editor "${editor.bin}": ${err.message}`));
    });
  });
}

function cleanup(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}
