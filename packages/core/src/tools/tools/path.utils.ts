import * as path from 'node:path';

/**
 * Resolve `filePath` to an absolute path and verify it stays within `projectRoot`.
 *
 * - Relative paths are resolved against `projectRoot`.
 * - Absolute paths are accepted as-is, but still validated.
 * - Throws an Error if the resolved path escapes `projectRoot`.
 *
 * @returns The resolved, validated absolute path.
 */
export function resolveAndValidatePath(filePath: string, projectRoot: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);

  // Ensure resolved path is within projectRoot (must start with root + sep, or equal root)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `Path "${filePath}" resolves outside the project root and cannot be accessed`,
    );
  }

  return resolved;
}
