import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  MemoryIndex,
  MemoryIndexEntry,
  MemoryComponentEntry,
  ProviderAdapter,
  ChatMessage,
} from '@nightfall/shared';
import { MemoryManager } from './memory.manager.js';

const execAsync = promisify(exec);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.nightfall',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
  '.turbo',
]);

/**
 * Derive a stable, kebab-case project slug from the directory basename.
 * Appends the first 6 characters of the HEAD commit hash when running inside
 * a git repository, making the slug unique across clones of the same project.
 *
 * Examples:
 *   /home/user/my-app  (git)  → "my-app-a1b2c3"
 *   /home/user/my-app  (no git) → "my-app"
 */
export async function deriveProjectSlug(projectRoot: string): Promise<string> {
  const rawName = path.basename(projectRoot);
  const slug =
    rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', {
      cwd: projectRoot,
      timeout: 3000,
    });
    const hash = stdout.trim().slice(0, 6);
    return `${slug}-${hash}`;
  } catch (_err) {
    return slug;
  }
}

interface InitResult {
  filesCreated: string[];
}

export interface InitPreview {
  files: Array<{ path: string; description: string }>;
}

interface ProjectInfo {
  name: string;
  description: string;
  readmeIntro: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  hasTypeScript: boolean;
  hasEnvExample: boolean;
  hasDocker: boolean;
  entryPoints: string[];
  srcDirs: string[];
}

/**
 * Scan the project and return a preview of files that would be created,
 * without writing anything to disk.
 */
export async function previewMemoryBank(projectRoot: string): Promise<InitPreview> {
  const projectInfo = await scanProject(projectRoot);
  const srcModules = await discoverModules(projectRoot, projectInfo.srcDirs);

  const files: Array<{ path: string; description: string }> = [
    { path: 'index.md', description: 'memory index (routing map for agents)' },
    { path: 'project.md', description: 'project goals, scope, requirements' },
    { path: 'tech.md', description: 'stack, dependencies, environment setup' },
    { path: 'patterns.md', description: 'architecture, key decisions, design patterns' },
    { path: 'progress.md', description: 'current status, known issues' },
  ];

  for (const mod of srcModules) {
    files.push({
      path: `components/${mod.name}.md`,
      description: mod.description,
    });
  }

  return { files };
}

/**
 * Initialize the memory bank for a project by scanning its directory structure
 * and generating the initial set of memory files.
 */
export async function initializeMemoryBank(projectRoot: string): Promise<InitResult> {
  const namespace = await deriveProjectSlug(projectRoot);
  const manager = new MemoryManager(projectRoot, namespace);
  await manager.ensureStructure();

  const projectInfo = await scanProject(projectRoot);
  const srcModules = await discoverModules(projectRoot, projectInfo.srcDirs);

  const filesCreated: string[] = [];

  // Generate index.md
  const index = buildIndex(srcModules);
  await manager.saveIndex(index);
  filesCreated.push('index.md');

  // Generate project.md
  const projectMd = buildProjectFile(projectInfo);
  await manager.updateFile('project.md', projectMd);
  filesCreated.push('project.md');

  // Generate tech.md
  const techMd = buildTechFile(projectInfo);
  await manager.updateFile('tech.md', techMd);
  filesCreated.push('tech.md');

  // Generate patterns.md
  const patternsMd = buildPatternsFile(projectInfo);
  await manager.updateFile('patterns.md', patternsMd);
  filesCreated.push('patterns.md');

  // Generate progress.md
  const progressMd = buildProgressFile();
  await manager.updateFile('progress.md', progressMd);
  filesCreated.push('progress.md');

  // Generate component files
  for (const mod of srcModules) {
    const componentMd = buildComponentFile(mod);
    await manager.updateFile(`components/${mod.name}.md`, componentMd);
    filesCreated.push(`components/${mod.name}.md`);
  }

  return { filesCreated };
}

// ---------------------------------------------------------------------------
// LLM-powered init helpers
// ---------------------------------------------------------------------------

async function buildFolderTree(projectRoot: string, maxDepth = 2, depth = 0): Promise<string[]> {
  if (depth >= maxDepth) return [];
  const lines: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectRoot, { withFileTypes: true, encoding: 'utf8' });
  } catch (_err) {
    return [];
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const indent = '  '.repeat(depth);
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      const children = await buildFolderTree(
        path.join(projectRoot, entry.name),
        maxDepth,
        depth + 1,
      );
      lines.push(...children);
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
  return lines;
}

async function readFileTruncated(filePath: string, maxChars = 4000): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.length > maxChars ? content.slice(0, maxChars) + '\n...(truncated)' : content;
  } catch (_err) {
    return '';
  }
}

async function gatherProjectContext(projectRoot: string, info: ProjectInfo): Promise<string> {
  const parts: string[] = [];

  // Folder tree (2 levels)
  const tree = await buildFolderTree(projectRoot);
  if (tree.length > 0) {
    parts.push('## Directory Structure\n```\n' + tree.join('\n') + '\n```');
  }

  // Key files — package.json always first
  const keyFiles: string[] = [];
  const candidateFiles = [
    'package.json',
    'CLAUDE.md',
    'AI.md',
    'CONTRIBUTING.md',
    'go.mod',
    'requirements.txt',
    'Cargo.toml',
    'pyproject.toml',
  ];
  for (const f of candidateFiles) {
    try {
      await fs.access(path.join(projectRoot, f));
      keyFiles.push(f);
    } catch (_err) {
      // not present
    }
  }
  // Add entry points from package.json
  for (const ep of info.entryPoints.slice(0, 2)) {
    if (!keyFiles.includes(ep)) keyFiles.push(ep);
  }

  // Read up to 5 key files
  let fileCount = 0;
  for (const rel of keyFiles) {
    if (fileCount >= 5) break;
    const content = await readFileTruncated(path.join(projectRoot, rel));
    if (content) {
      parts.push(`## ${rel}\n\`\`\`\n${content}\n\`\`\``);
      fileCount++;
    }
  }

  return parts.join('\n\n');
}

async function collectResponse(
  provider: ProviderAdapter,
  messages: ChatMessage[],
): Promise<string> {
  let full = '';
  for await (const chunk of provider.complete(messages)) {
    full += chunk;
  }
  return full.trim();
}

const INIT_SYSTEM_PROMPT = `You are initializing the memory bank for an AI coding agent system called Nightfall.
Agents read these files fresh at the start of every task — write clearly and concisely for an AI reader, not a human.

Output ALL of the following files in this exact delimited format (include all headers exactly as shown):

=== project.md ===
# Project
<name, purpose, goals, explicit scope (what's in / what's out)>

=== tech.md ===
# Tech Stack
<language, framework, key dependencies, build commands, setup steps, env vars, known constraints>

=== patterns.md ===
# Patterns & Architecture
<text-based architecture diagram, naming conventions, design decisions, anti-patterns to avoid>

=== progress.md ===
# Progress
<initialization timestamp + one honest note that the bank was just initialized and agents will expand it>

=== components/<name>.md ===
# <name>
<what the module does, key exported APIs/classes, file map, gotchas for agents editing it>

Repeat the components section for each significant module discovered in the project.
Do not output anything outside the delimited sections. Do not add markdown code fences around the sections themselves.`;

function parseInitOutput(
  output: string,
): Map<string, string> {
  const fileMap = new Map<string, string>();
  // Split on === <filename> === markers
  const parts = output.split(/^=== (.+?) ===/m);
  // parts[0] is any text before first marker (ignore)
  // then [filename, content, filename, content, ...]
  for (let i = 1; i < parts.length - 1; i += 2) {
    const filename = parts[i].trim();
    const content = parts[i + 1].trim();
    if (filename && content) {
      fileMap.set(filename, content + '\n');
    }
  }
  return fileMap;
}

/**
 * Initialize the memory bank using an LLM to analyze the project and write
 * meaningful content. Falls back to the static version if the LLM call fails.
 */
export async function initializeMemoryBankWithLLM(
  projectRoot: string,
  provider: ProviderAdapter,
): Promise<InitResult> {
  const namespace = await deriveProjectSlug(projectRoot);
  const manager = new MemoryManager(projectRoot, namespace);
  await manager.ensureStructure();

  const projectInfo = await scanProject(projectRoot);
  const srcModules = await discoverModules(projectRoot, projectInfo.srcDirs);

  let llmFiles: Map<string, string>;
  try {
    const context = await gatherProjectContext(projectRoot, projectInfo);
    const messages: ChatMessage[] = [
      { role: 'system', content: INIT_SYSTEM_PROMPT },
      { role: 'user', content: context },
    ];
    const output = await collectResponse(provider, messages);
    llmFiles = parseInitOutput(output);
  } catch (err) {
    process.stderr.write(
      `[init] LLM call failed, falling back to static templates: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return initializeMemoryBank(projectRoot);
  }

  const filesCreated: string[] = [];

  // Build index from discovered modules
  const index = buildIndex(srcModules);
  await manager.saveIndex(index);
  filesCreated.push('index.md');

  // Write LLM-generated files, fall back to static builders for missing ones
  const staticFallbacks: Record<string, () => string> = {
    'project.md': () => buildProjectFile(projectInfo),
    'tech.md': () => buildTechFile(projectInfo),
    'patterns.md': () => buildPatternsFile(projectInfo),
    'progress.md': () => buildProgressFile(),
  };

  for (const [filename, builder] of Object.entries(staticFallbacks)) {
    const content = llmFiles.get(filename) ?? builder();
    await manager.updateFile(filename, content);
    filesCreated.push(filename);
  }

  // Component files — use LLM output when available, fall back to static
  for (const mod of srcModules) {
    const componentPath = `components/${mod.name}.md`;
    const content = llmFiles.get(componentPath) ?? buildComponentFile(mod);
    await manager.updateFile(componentPath, content);
    filesCreated.push(componentPath);
  }

  // Write any extra component files the LLM generated beyond what we discovered
  for (const [filename, content] of llmFiles) {
    if (filename.startsWith('components/') && !filesCreated.includes(filename)) {
      await manager.updateFile(filename, content);
      filesCreated.push(filename);
    }
  }

  return { filesCreated };
}

// ---------------------------------------------------------------------------

interface ModuleInfo {
  name: string;
  files: string[];
  description: string;
}

async function scanProject(projectRoot: string): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    name: '',
    description: '',
    readmeIntro: '',
    dependencies: {},
    devDependencies: {},
    scripts: {},
    hasTypeScript: false,
    hasEnvExample: false,
    hasDocker: false,
    entryPoints: [],
    srcDirs: [],
  };

  // Read package.json if available
  try {
    const pkgRaw = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    info.name = (pkg.name as string) || path.basename(projectRoot);
    info.description = (pkg.description as string) || '';
    info.dependencies = (pkg.dependencies as Record<string, string>) || {};
    info.devDependencies = (pkg.devDependencies as Record<string, string>) || {};
    info.scripts = (pkg.scripts as Record<string, string>) || {};
    if (pkg.main) info.entryPoints.push(pkg.main as string);
  } catch (_err) {
    info.name = path.basename(projectRoot);
  }

  // Check for TypeScript
  try {
    await fs.access(path.join(projectRoot, 'tsconfig.json'));
    info.hasTypeScript = true;
  } catch (_err) {
    // not a TS project
  }

  // Extract first paragraph from README.md
  try {
    const readmeRaw = await fs.readFile(path.join(projectRoot, 'README.md'), 'utf8');
    const paragraphs = (readmeRaw.split(/\n{2,}/) as string[])
      .map((p: string) => p.replace(/^#+\s+.*$/m, '').trim())
      .filter((p: string) => p.length > 0 && !p.startsWith('#'));
    if (paragraphs.length > 0) {
      info.readmeIntro = paragraphs[0].replace(/\n/g, ' ').trim();
    }
  } catch (_err) {
    // no README
  }

  // Check for .env.example
  try {
    await fs.access(path.join(projectRoot, '.env.example'));
    info.hasEnvExample = true;
  } catch (_err) {
    // no .env.example
  }

  // Check for Docker files
  try {
    await fs.access(path.join(projectRoot, 'Dockerfile'));
    info.hasDocker = true;
  } catch (_err) {
    // no Dockerfile
  }
  if (!info.hasDocker) {
    try {
      await fs.access(path.join(projectRoot, 'docker-compose.yml'));
      info.hasDocker = true;
    } catch (_err) {
      // no docker-compose.yml
    }
  }

  // Discover top-level source directories
  const topEntries = await fs.readdir(projectRoot, { withFileTypes: true, encoding: 'utf8' });
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name === 'src' || entry.name === 'lib' || entry.name === 'app') {
      info.srcDirs.push(entry.name);
    }
    // Also check for monorepo packages/*/src
    if (entry.name === 'packages') {
      const pkgDirs = await fs.readdir(path.join(projectRoot, 'packages'), {
        withFileTypes: true,
        encoding: 'utf8',
      });
      for (const pkgDir of pkgDirs) {
        if (!pkgDir.isDirectory()) continue;
        try {
          await fs.access(path.join(projectRoot, 'packages', pkgDir.name, 'src'));
          info.srcDirs.push(`packages/${pkgDir.name}/src`);
        } catch (_err) {
          // no src directory
        }
      }
    }
  }

  return info;
}

async function discoverModules(projectRoot: string, srcDirs: string[]): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  for (const srcDir of srcDirs) {
    const fullDir = path.join(projectRoot, srcDir);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(fullDir, { withFileTypes: true, encoding: 'utf8' });
    } catch (_err) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const modulePath = path.join(srcDir, entry.name);
      const files = await listFiles(path.join(projectRoot, modulePath));
      const relFiles = files.map((f) => path.relative(projectRoot, f));

      if (relFiles.length > 0) {
        const moduleName = srcDir.includes('/')
          ? `${srcDir.split('/')[1]}-${entry.name}`
          : entry.name;

        modules.push({
          name: moduleName,
          files: relFiles,
          description: inferModuleDescription(entry.name, relFiles),
        });
      }
    }
  }

  return modules;
}

async function listFiles(dirPath: string, maxDepth = 3, depth = 0): Promise<string[]> {
  if (depth >= maxDepth) return [];

  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' });
  } catch (_err) {
    return [];
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      results.push(full);
    } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      const nested = await listFiles(full, maxDepth, depth + 1);
      results.push(...nested);
    }
  }

  return results;
}

function inferModuleDescription(name: string, files: string[]): string {
  const fileNames = files.map((f) => path.basename(f).toLowerCase());
  const hints: string[] = [];

  if (fileNames.some((f) => f.includes('test') || f.includes('spec'))) {
    hints.push('includes tests');
  }
  if (fileNames.some((f) => f.includes('config') || f.includes('defaults'))) {
    hints.push('configuration');
  }
  if (fileNames.some((f) => f.includes('route') || f.includes('endpoint') || f.includes('api'))) {
    hints.push('API/routing');
  }
  if (fileNames.some((f) => f.includes('auth') || f.includes('login'))) {
    hints.push('authentication');
  }
  if (fileNames.some((f) => f.includes('model') || f.includes('schema') || f.includes('db'))) {
    hints.push('data models');
  }

  const desc = hints.length > 0 ? hints.join(', ') : 'module';
  return `${name} — ${desc} (${files.length} files)`;
}

function buildIndex(modules: ModuleInfo[]): MemoryIndex {
  const entries: MemoryIndexEntry[] = [
    { file: 'project.md', description: 'project goals, scope, requirements' },
    { file: 'tech.md', description: 'stack, dependencies, environment setup' },
    { file: 'patterns.md', description: 'architecture, key decisions, design patterns' },
    { file: 'progress.md', description: 'current status, known issues' },
  ];

  const components: MemoryComponentEntry[] = modules.map((m) => ({
    file: `components/${m.name}.md`,
    description: m.description,
  }));

  return { entries, components };
}

function buildProjectFile(info: ProjectInfo): string {
  const lines = ['# Project', '', `**Name:** ${info.name}`];

  const desc = info.readmeIntro || info.description;
  if (desc) {
    lines.push(`**Description:** ${desc}`);
  }

  if (info.entryPoints.length > 0) {
    lines.push(`**Entry points:** ${info.entryPoints.join(', ')}`);
  }

  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push('_To be filled by Memory Manager after first task._');
  lines.push('');

  return lines.join('\n') + '\n';
}

function buildTechFile(info: ProjectInfo): string {
  const lines = ['# Tech Stack', ''];

  if (info.hasTypeScript) {
    lines.push('- **Language:** TypeScript');
  }

  if (info.hasEnvExample) {
    lines.push('- **Environment variables:** see `.env.example`');
  }

  if (info.hasDocker) {
    lines.push('- **Containerization:** Docker');
  }

  const depNames = Object.keys(info.dependencies);

  if (depNames.length > 0) {
    lines.push('');
    lines.push('## Dependencies');
    lines.push('');
    for (const [name, version] of Object.entries(info.dependencies)) {
      lines.push(`- ${name}: ${version}`);
    }
  }

  if (Object.keys(info.devDependencies).length > 0) {
    lines.push('');
    lines.push('## Dev Dependencies');
    lines.push('');
    for (const [name, version] of Object.entries(info.devDependencies)) {
      lines.push(`- ${name}: ${version}`);
    }
  }

  if (Object.keys(info.scripts).length > 0) {
    lines.push('');
    lines.push('## Scripts');
    lines.push('');
    for (const [name, cmd] of Object.entries(info.scripts)) {
      lines.push(`- \`${name}\`: ${cmd}`);
    }
  }

  lines.push('');

  return lines.join('\n') + '\n';
}

function buildPatternsFile(info: ProjectInfo): string {
  const lines = ['# Patterns & Architecture', ''];

  if (info.srcDirs.length > 0) {
    lines.push('## Project Structure');
    lines.push('');
    for (const dir of info.srcDirs) {
      lines.push(`- \`${dir}/\``);
    }
    lines.push('');
  }

  lines.push('## Design Decisions');
  lines.push('');
  lines.push('_To be populated by Memory Manager as patterns emerge._');
  lines.push('');

  return lines.join('\n') + '\n';
}

function buildProgressFile(): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return ['# Progress', '', `- [${timestamp}] Memory bank initialized`, ''].join('\n');
}

function buildComponentFile(mod: ModuleInfo): string {
  const lines = [`# ${mod.name}`, '', mod.description, '', '## Files', ''];

  for (const file of mod.files) {
    lines.push(`- \`${file}\``);
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('_To be populated by Memory Manager._');
  lines.push('');

  return lines.join('\n') + '\n';
}
