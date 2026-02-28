import fs from 'node:fs/promises';
import path from 'node:path';

const MEMORY_DIR = '.nightfall/memory';

function resolveMemoryPath(projectRoot: string, relativePath: string): string {
  return path.join(projectRoot, MEMORY_DIR, relativePath);
}

/**
 * Write content to a memory file, creating parent directories as needed.
 */
export async function writeMemoryFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = resolveMemoryPath(projectRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Read a memory file's content. Returns null if the file does not exist.
 */
export async function readMemoryFile(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  const filePath = resolveMemoryPath(projectRoot, relativePath);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Append content to a memory file (used for progress.md entries).
 * Creates the file if it doesn't exist.
 */
export async function appendToMemoryFile(
  projectRoot: string,
  relativePath: string,
  entry: string,
): Promise<void> {
  const filePath = resolveMemoryPath(projectRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const existing = await readMemoryFile(projectRoot, relativePath);
  const content = existing ? existing.trimEnd() + '\n' + entry + '\n' : entry + '\n';
  await fs.writeFile(filePath, content, 'utf8');
}

/**
 * Update a memory file with compaction. In Phase 5 this is a simple
 * replace — future phases will route through the LLM for summarization.
 */
export async function updateMemoryFile(
  projectRoot: string,
  relativePath: string,
  newContent: string,
): Promise<void> {
  await writeMemoryFile(projectRoot, relativePath, newContent);
}

/**
 * Ensure the full memory bank directory structure exists.
 */
export async function ensureMemoryStructure(projectRoot: string): Promise<void> {
  const memoryRoot = path.join(projectRoot, MEMORY_DIR);
  await fs.mkdir(path.join(memoryRoot, 'components'), { recursive: true });
}
