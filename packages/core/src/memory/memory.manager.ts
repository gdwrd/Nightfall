import type { MemoryIndex } from '@nightfall/shared';
import { parseIndex, serializeIndex } from './memory.parser.js';
import {
  readMemoryFile,
  writeMemoryFile,
  appendToMemoryFile,
  updateMemoryFile,
  ensureMemoryStructure,
} from './memory.writer.js';

const INDEX_FILE = 'index.md';
const PROGRESS_FILE = 'progress.md';

export class MemoryManager {
  constructor(private projectRoot: string) {}

  /**
   * Load and parse the memory index file.
   * Returns an empty index if the file doesn't exist yet.
   */
  async loadIndex(): Promise<MemoryIndex> {
    const content = await readMemoryFile(this.projectRoot, INDEX_FILE);
    if (!content) {
      return { entries: [], components: [] };
    }
    return parseIndex(content);
  }

  /**
   * Save a MemoryIndex back to disk as index.md.
   */
  async saveIndex(index: MemoryIndex): Promise<void> {
    const content = serializeIndex(index);
    await writeMemoryFile(this.projectRoot, INDEX_FILE, content);
  }

  /**
   * Load a memory file by its path relative to .nightfall/memory/.
   * Returns the raw string content, or null if the file doesn't exist.
   */
  async loadFile(relativePath: string): Promise<string | null> {
    return readMemoryFile(this.projectRoot, relativePath);
  }

  /**
   * Write or overwrite a memory file.
   * Uses the compaction-aware writer (simple replace in Phase 5,
   * LLM-summarized in later phases).
   */
  async updateFile(relativePath: string, content: string): Promise<void> {
    await updateMemoryFile(this.projectRoot, relativePath, content);
  }

  /**
   * Append a timestamped entry to progress.md.
   */
  async appendToProgress(entry: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const formatted = `- [${timestamp}] ${entry}`;
    await appendToMemoryFile(this.projectRoot, PROGRESS_FILE, formatted);
  }

  /**
   * Search the index for files whose descriptions match any of the given keywords.
   * Returns an array of file paths (relative to .nightfall/memory/) that match.
   */
  async getRelevantFiles(keywords: string[]): Promise<string[]> {
    const index = await this.loadIndex();
    const lower = keywords.map((k) => k.toLowerCase());

    const matches: string[] = [];

    const allEntries = [
      ...index.entries.map((e) => ({ file: e.file, description: e.description })),
      ...index.components.map((c) => ({ file: c.file, description: c.description })),
    ];

    for (const entry of allEntries) {
      const text = `${entry.file} ${entry.description}`.toLowerCase();
      if (lower.some((kw) => text.includes(kw))) {
        matches.push(entry.file);
      }
    }

    return matches;
  }

  /**
   * Ensure the .nightfall/memory/ directory structure exists,
   * including the components/ subdirectory.
   */
  async ensureStructure(): Promise<void> {
    await ensureMemoryStructure(this.projectRoot);
  }
}
