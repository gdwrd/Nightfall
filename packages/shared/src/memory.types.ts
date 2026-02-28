export interface MemoryIndex {
  entries: MemoryIndexEntry[];
  components: MemoryComponentEntry[];
}

export interface MemoryIndexEntry {
  file: string;
  description: string;
}

export interface MemoryComponentEntry {
  file: string; // relative to .nightfall/memory/
  description: string;
}
