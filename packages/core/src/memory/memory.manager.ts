import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryIndex, ProviderAdapter, CompactionResult } from '@nightfall/shared';
import { parseIndex, serializeIndex } from './memory.parser.js';
import {
  readMemoryFile,
  writeMemoryFile,
  appendToMemoryFile,
  updateMemoryFile,
  ensureMemoryStructure,
} from './memory.writer.js';
import { COMPACT_MEMORY_SYSTEM_PROMPT } from '../agents/agent.prompts.js';

const INDEX_FILE = 'index.md';
const PROGRESS_FILE = 'progress.md';

export class MemoryManager {
  private readonly namespace: string | undefined;

  constructor(
    private projectRoot: string,
    namespace?: string,
  ) {
    this.namespace = namespace;
  }

  /** Prefix a memory-relative path with the namespace directory when set. */
  private ns(relativePath: string): string {
    return this.namespace ? `${this.namespace}/${relativePath}` : relativePath;
  }

  /**
   * Load and parse the memory index file.
   * Returns an empty index if the file doesn't exist yet.
   */
  async loadIndex(): Promise<MemoryIndex> {
    const content = await readMemoryFile(this.projectRoot, this.ns(INDEX_FILE));
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
    await writeMemoryFile(this.projectRoot, this.ns(INDEX_FILE), content);
  }

  /**
   * Load a memory file by its path relative to .nightfall/memory/.
   * Returns the raw string content, or null if the file doesn't exist.
   */
  async loadFile(relativePath: string): Promise<string | null> {
    return readMemoryFile(this.projectRoot, this.ns(relativePath));
  }

  /**
   * Write or overwrite a memory file.
   * Uses the compaction-aware writer (simple replace in Phase 5,
   * LLM-summarized in later phases).
   */
  async updateFile(relativePath: string, content: string): Promise<void> {
    await updateMemoryFile(this.projectRoot, this.ns(relativePath), content);
  }

  /**
   * Append a timestamped entry to progress.md.
   */
  async appendToProgress(entry: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const formatted = `- [${timestamp}] ${entry}`;
    await appendToMemoryFile(this.projectRoot, this.ns(PROGRESS_FILE), formatted);
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
   * When a namespace is set, creates .nightfall/memory/<namespace>/components/.
   */
  async ensureStructure(): Promise<void> {
    if (this.namespace) {
      const namespacedRoot = path.join(this.projectRoot, '.nightfall', 'memory', this.namespace);
      await fs.mkdir(path.join(namespacedRoot, 'components'), { recursive: true });
    } else {
      await ensureMemoryStructure(this.projectRoot);
    }
  }

  /**
   * Compact all memory files using the LLM to summarize and deduplicate entries.
   * Backs up originals to .nightfall/memory/.compact-backup/ before overwriting.
   * Returns a CompactionResult for each processed file.
   */
  async compactAll(provider: ProviderAdapter): Promise<CompactionResult[]> {
    const baseMemoryDir = path.join(this.projectRoot, '.nightfall', 'memory');
    const memoryDir = this.namespace ? path.join(baseMemoryDir, this.namespace) : baseMemoryDir;
    const backupDir = path.join(memoryDir, '.compact-backup');

    // Collect all .md files including those in subdirectories (e.g. components/)
    const collectMdFiles = async (dir: string, relBase: string): Promise<string[]> => {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (_err) {
        return [];
      }
      const results: string[] = [];
      for (const entry of entries) {
        if (entry === '.compact-backup') continue;
        const fullPath = path.join(dir, entry);
        const rel = relBase ? `${relBase}/${entry}` : entry;
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(fullPath);
        } catch (_err) {
          continue;
        }
        if (stat.isDirectory()) {
          const nested = await collectMdFiles(fullPath, rel);
          results.push(...nested);
        } else if (entry.endsWith('.md')) {
          results.push(rel);
        }
      }
      return results;
    };

    const files = await collectMdFiles(memoryDir, '');
    if (files.length === 0) return [];

    await fs.mkdir(backupDir, { recursive: true });

    const results: CompactionResult[] = [];

    for (const file of files) {
      const filePath = path.join(memoryDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const before = content.length;

      // Ensure backup subdirectory exists for nested files
      const backupFilePath = path.join(backupDir, file);
      await fs.mkdir(path.dirname(backupFilePath), { recursive: true });

      // Back up original before overwriting
      await fs.copyFile(filePath, backupFilePath);

      // Compact via LLM
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: COMPACT_MEMORY_SYSTEM_PROMPT },
        { role: 'user', content: content },
      ];

      let compacted = '';
      for await (const chunk of provider.complete(messages)) {
        compacted += chunk;
      }
      compacted = compacted.trim();

      if (compacted.length > 0) {
        await fs.writeFile(filePath, compacted + '\n', 'utf8');
      }

      const after = compacted.length > 0 ? compacted.length : before;
      results.push({
        file,
        before,
        after,
        removed: Math.max(0, before - after),
      });
    }

    return results;
  }
}
