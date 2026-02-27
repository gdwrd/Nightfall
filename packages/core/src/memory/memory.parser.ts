import type { MemoryIndex, MemoryIndexEntry, MemoryComponentEntry } from '@nightfall/shared'

/**
 * Parse the index.md file content into a structured MemoryIndex.
 *
 * Expected format:
 * ```
 * # Memory Index
 * - project.md — project goals, scope, requirements
 * - tech.md — stack, deps, environment setup
 * ## Components
 * - components/db.md — database schema, ORM setup
 * - components/auth.md — authentication flow
 * ```
 */
export function parseIndex(content: string): MemoryIndex {
  const entries: MemoryIndexEntry[] = []
  const components: MemoryComponentEntry[] = []

  let inComponentsSection = false
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect "## Components" section header
    if (/^##\s+Components/i.test(trimmed)) {
      inComponentsSection = true
      continue
    }

    // A new h2 section resets component context
    if (/^##\s+/.test(trimmed) && !(/^##\s+Components/i.test(trimmed))) {
      inComponentsSection = false
      continue
    }

    // Skip h1 headers and empty lines
    if (/^#\s+/.test(trimmed) || trimmed === '') {
      continue
    }

    // Parse list items: "- file.md — description" or "- file.md - description"
    const match = trimmed.match(/^-\s+(\S+)\s+(?:—|-)\s+(.+)$/)
    if (!match) continue

    const [, file, description] = match

    if (inComponentsSection) {
      components.push({ file, description })
    } else {
      entries.push({ file, description })
    }
  }

  return { entries, components }
}

/**
 * Serialize a MemoryIndex back to index.md markdown format.
 */
export function serializeIndex(index: MemoryIndex): string {
  const lines: string[] = ['# Memory Index']

  for (const entry of index.entries) {
    lines.push(`- ${entry.file} — ${entry.description}`)
  }

  if (index.components.length > 0) {
    lines.push('## Components')
    for (const comp of index.components) {
      lines.push(`- ${comp.file} — ${comp.description}`)
    }
  }

  return lines.join('\n') + '\n'
}
