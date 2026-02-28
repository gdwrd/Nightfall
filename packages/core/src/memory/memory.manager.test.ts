import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseIndex, serializeIndex } from './memory.parser.js';
import { MemoryManager } from './memory.manager.js';
import { initializeMemoryBank } from './memory.init.js';

const TEST_ROOT = `/tmp/nightfall-memory-test-${process.pid}`;
const MEMORY_DIR = path.join(TEST_ROOT, '.nightfall', 'memory');

function writeTestFile(relativePath: string, content: string) {
  const full = path.join(MEMORY_DIR, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function readTestFile(relativePath: string): string {
  return fs.readFileSync(path.join(MEMORY_DIR, relativePath), 'utf8');
}

beforeEach(() => {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true });
  }
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true });
  }
});

// ─── memory.parser tests ───────────────────────────────────────

describe('parseIndex', () => {
  it('parses a standard index.md into MemoryIndex', () => {
    const content = [
      '# Memory Index',
      '- project.md — project goals, scope, requirements',
      '- tech.md — stack, deps, environment setup',
      '- patterns.md — architecture, key decisions, design patterns',
      '- progress.md — current status, known issues',
      '## Components',
      '- components/db.md — database schema, ORM setup, migration patterns',
      '- components/auth.md — authentication flow, JWT config, session handling',
      '- components/api.md — REST endpoints, request/response contracts',
    ].join('\n');

    const index = parseIndex(content);

    expect(index.entries).toHaveLength(4);
    expect(index.entries[0]).toEqual({
      file: 'project.md',
      description: 'project goals, scope, requirements',
    });
    expect(index.entries[3]).toEqual({
      file: 'progress.md',
      description: 'current status, known issues',
    });

    expect(index.components).toHaveLength(3);
    expect(index.components[0]).toEqual({
      file: 'components/db.md',
      description: 'database schema, ORM setup, migration patterns',
    });
    expect(index.components[2]).toEqual({
      file: 'components/api.md',
      description: 'REST endpoints, request/response contracts',
    });
  });

  it('returns empty arrays for empty content', () => {
    const index = parseIndex('');
    expect(index.entries).toEqual([]);
    expect(index.components).toEqual([]);
  });

  it('handles index with no components section', () => {
    const content = [
      '# Memory Index',
      '- project.md — project goals',
      '- tech.md — tech stack',
    ].join('\n');

    const index = parseIndex(content);
    expect(index.entries).toHaveLength(2);
    expect(index.components).toEqual([]);
  });

  it('handles dash separator as well as em-dash', () => {
    const content = ['# Memory Index', '- project.md - project goals with dash'].join('\n');

    const index = parseIndex(content);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].description).toBe('project goals with dash');
  });
});

describe('serializeIndex', () => {
  it('serializes a MemoryIndex back to markdown', () => {
    const index = {
      entries: [
        { file: 'project.md', description: 'project goals' },
        { file: 'tech.md', description: 'tech stack' },
      ],
      components: [{ file: 'components/auth.md', description: 'auth flow' }],
    };

    const output = serializeIndex(index);
    expect(output).toContain('# Memory Index');
    expect(output).toContain('- project.md — project goals');
    expect(output).toContain('- tech.md — tech stack');
    expect(output).toContain('## Components');
    expect(output).toContain('- components/auth.md — auth flow');
  });

  it('omits Components section when there are none', () => {
    const index = {
      entries: [{ file: 'project.md', description: 'goals' }],
      components: [],
    };

    const output = serializeIndex(index);
    expect(output).not.toContain('## Components');
  });

  it('round-trips: parse(serialize(index)) === index', () => {
    const original = {
      entries: [
        { file: 'project.md', description: 'project goals, scope' },
        { file: 'tech.md', description: 'stack, deps, setup' },
      ],
      components: [
        { file: 'components/db.md', description: 'database schema' },
        { file: 'components/api.md', description: 'REST endpoints' },
      ],
    };

    const serialized = serializeIndex(original);
    const parsed = parseIndex(serialized);

    expect(parsed).toEqual(original);
  });
});

// ─── MemoryManager tests ───────────────────────────────────────

describe('MemoryManager', () => {
  it('ensureStructure creates the memory directory hierarchy', async () => {
    const manager = new MemoryManager(TEST_ROOT);
    await manager.ensureStructure();

    expect(fs.existsSync(MEMORY_DIR)).toBe(true);
    expect(fs.existsSync(path.join(MEMORY_DIR, 'components'))).toBe(true);
  });

  it('loadIndex returns empty index when no index.md exists', async () => {
    const manager = new MemoryManager(TEST_ROOT);
    const index = await manager.loadIndex();

    expect(index.entries).toEqual([]);
    expect(index.components).toEqual([]);
  });

  it('loadIndex parses existing index.md', async () => {
    writeTestFile(
      'index.md',
      [
        '# Memory Index',
        '- project.md — goals',
        '## Components',
        '- components/auth.md — auth flow',
      ].join('\n'),
    );

    const manager = new MemoryManager(TEST_ROOT);
    const index = await manager.loadIndex();

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].file).toBe('project.md');
    expect(index.components).toHaveLength(1);
    expect(index.components[0].file).toBe('components/auth.md');
  });

  it('saveIndex writes a valid index.md', async () => {
    const manager = new MemoryManager(TEST_ROOT);
    await manager.ensureStructure();

    await manager.saveIndex({
      entries: [{ file: 'project.md', description: 'goals' }],
      components: [{ file: 'components/db.md', description: 'database' }],
    });

    const content = readTestFile('index.md');
    expect(content).toContain('- project.md — goals');
    expect(content).toContain('- components/db.md — database');
  });

  it('loadFile returns content of an existing file', async () => {
    writeTestFile('tech.md', '# Tech Stack\n- TypeScript\n');

    const manager = new MemoryManager(TEST_ROOT);
    const content = await manager.loadFile('tech.md');

    expect(content).toBe('# Tech Stack\n- TypeScript\n');
  });

  it('loadFile returns null for non-existent file', async () => {
    const manager = new MemoryManager(TEST_ROOT);
    const content = await manager.loadFile('nonexistent.md');

    expect(content).toBeNull();
  });

  it('updateFile writes new content', async () => {
    const manager = new MemoryManager(TEST_ROOT);
    await manager.ensureStructure();

    await manager.updateFile('patterns.md', '# Patterns\n\n- MVC architecture\n');

    const content = readTestFile('patterns.md');
    expect(content).toBe('# Patterns\n\n- MVC architecture\n');
  });

  it('updateFile overwrites existing content', async () => {
    writeTestFile('patterns.md', '# Old Content');

    const manager = new MemoryManager(TEST_ROOT);
    await manager.updateFile('patterns.md', '# New Content');

    const content = readTestFile('patterns.md');
    expect(content).toBe('# New Content');
  });

  it('appendToProgress adds timestamped entry', async () => {
    const manager = new MemoryManager(TEST_ROOT);
    await manager.ensureStructure();

    await manager.appendToProgress('Implemented auth module');

    const content = readTestFile('progress.md');
    expect(content).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Implemented auth module/);
  });

  it('appendToProgress appends to existing file', async () => {
    writeTestFile('progress.md', '# Progress\n\n- [2024-01-01 00:00:00] Initial setup\n');

    const manager = new MemoryManager(TEST_ROOT);
    await manager.appendToProgress('Added feature X');

    const content = readTestFile('progress.md');
    expect(content).toContain('Initial setup');
    expect(content).toContain('Added feature X');
  });

  it('getRelevantFiles returns matching files by keyword', async () => {
    writeTestFile(
      'index.md',
      [
        '# Memory Index',
        '- project.md — project goals, scope, requirements',
        '- tech.md — stack, deps, environment setup',
        '## Components',
        '- components/auth.md — authentication flow, JWT config, session handling',
        '- components/db.md — database schema, ORM setup',
        '- components/api.md — REST endpoints, request/response contracts',
      ].join('\n'),
    );

    const manager = new MemoryManager(TEST_ROOT);

    const authFiles = await manager.getRelevantFiles(['auth', 'jwt']);
    expect(authFiles).toContain('components/auth.md');
    expect(authFiles).not.toContain('components/db.md');

    const dbFiles = await manager.getRelevantFiles(['database', 'schema']);
    expect(dbFiles).toContain('components/db.md');
    expect(dbFiles).not.toContain('components/auth.md');
  });

  it('getRelevantFiles is case-insensitive', async () => {
    writeTestFile(
      'index.md',
      [
        '# Memory Index',
        '- project.md — Project Goals',
        '## Components',
        '- components/auth.md — Authentication Flow',
      ].join('\n'),
    );

    const manager = new MemoryManager(TEST_ROOT);
    const files = await manager.getRelevantFiles(['authentication']);

    expect(files).toContain('components/auth.md');
  });

  it('getRelevantFiles returns empty array when nothing matches', async () => {
    writeTestFile('index.md', ['# Memory Index', '- project.md — goals'].join('\n'));

    const manager = new MemoryManager(TEST_ROOT);
    const files = await manager.getRelevantFiles(['nonexistent']);

    expect(files).toEqual([]);
  });

  it('getRelevantFiles matches on file names too', async () => {
    writeTestFile(
      'index.md',
      [
        '# Memory Index',
        '## Components',
        '- components/auth.md — login and session management',
      ].join('\n'),
    );

    const manager = new MemoryManager(TEST_ROOT);
    const files = await manager.getRelevantFiles(['auth']);

    expect(files).toContain('components/auth.md');
  });
});

// ─── memory.init tests ─────────────────────────────────────────

describe('initializeMemoryBank', () => {
  it('creates correct directory structure on a sample project', async () => {
    // Set up a minimal project structure
    const projectRoot = path.join(TEST_ROOT, 'sample-project');
    fs.mkdirSync(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'login.ts'),
      'export function login() {}',
    );
    fs.writeFileSync(path.join(projectRoot, 'src', 'api', 'routes.ts'), 'export const routes = []');
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'sample-project',
        description: 'A test project',
        dependencies: { express: '^4.18.0' },
        scripts: { build: 'tsc', test: 'vitest' },
      }),
    );
    fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), '{}');

    const result = await initializeMemoryBank(projectRoot);

    // Verify files were created
    expect(result.filesCreated).toContain('index.md');
    expect(result.filesCreated).toContain('project.md');
    expect(result.filesCreated).toContain('tech.md');
    expect(result.filesCreated).toContain('patterns.md');
    expect(result.filesCreated).toContain('progress.md');

    // Verify memory directory exists
    const memDir = path.join(projectRoot, '.nightfall', 'memory');
    expect(fs.existsSync(memDir)).toBe(true);
    expect(fs.existsSync(path.join(memDir, 'components'))).toBe(true);

    // Verify index.md content
    const indexContent = fs.readFileSync(path.join(memDir, 'index.md'), 'utf8');
    expect(indexContent).toContain('project.md');
    expect(indexContent).toContain('tech.md');
    expect(indexContent).toContain('patterns.md');
    expect(indexContent).toContain('progress.md');

    // Verify project.md content
    const projectContent = fs.readFileSync(path.join(memDir, 'project.md'), 'utf8');
    expect(projectContent).toContain('sample-project');
    expect(projectContent).toContain('A test project');

    // Verify tech.md content
    const techContent = fs.readFileSync(path.join(memDir, 'tech.md'), 'utf8');
    expect(techContent).toContain('TypeScript');
    expect(techContent).toContain('express');

    // Verify progress.md
    const progressContent = fs.readFileSync(path.join(memDir, 'progress.md'), 'utf8');
    expect(progressContent).toContain('Memory bank initialized');
  });

  it('generates component files for src/ subdirectories', async () => {
    const projectRoot = path.join(TEST_ROOT, 'components-project');
    fs.mkdirSync(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'db'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'auth', 'login.ts'), '');
    fs.writeFileSync(path.join(projectRoot, 'src', 'db', 'models.ts'), '');
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'comp-project' }),
    );

    const result = await initializeMemoryBank(projectRoot);

    expect(result.filesCreated).toContain('components/auth.md');
    expect(result.filesCreated).toContain('components/db.md');

    const memDir = path.join(projectRoot, '.nightfall', 'memory');
    expect(fs.existsSync(path.join(memDir, 'components', 'auth.md'))).toBe(true);
    expect(fs.existsSync(path.join(memDir, 'components', 'db.md'))).toBe(true);
  });

  it('works with monorepo packages structure', async () => {
    const projectRoot = path.join(TEST_ROOT, 'monorepo-project');
    fs.mkdirSync(path.join(projectRoot, 'packages', 'core', 'src', 'engine'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'packages', 'cli', 'src', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'packages', 'core', 'src', 'engine', 'runner.ts'), '');
    fs.writeFileSync(path.join(projectRoot, 'packages', 'cli', 'src', 'ui', 'panel.ts'), '');
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'monorepo' }));

    const result = await initializeMemoryBank(projectRoot);

    // Should discover modules under packages/*/src/
    expect(result.filesCreated.some((f) => f.startsWith('components/'))).toBe(true);
  });

  it('handles project without package.json', async () => {
    const projectRoot = path.join(TEST_ROOT, 'no-pkg-project');
    fs.mkdirSync(path.join(projectRoot, 'src', 'main'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'main', 'app.py'), 'print("hello")');

    const result = await initializeMemoryBank(projectRoot);

    expect(result.filesCreated).toContain('index.md');
    expect(result.filesCreated).toContain('project.md');

    const memDir = path.join(projectRoot, '.nightfall', 'memory');
    const projectContent = fs.readFileSync(path.join(memDir, 'project.md'), 'utf8');
    expect(projectContent).toContain('no-pkg-project');
  });
});
