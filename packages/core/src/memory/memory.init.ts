import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import type { MemoryIndex, MemoryIndexEntry, MemoryComponentEntry } from '@nightfall/shared';
import { MemoryManager } from './memory.manager.js';

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
  const manager = new MemoryManager(projectRoot);
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
  } catch {
    info.name = path.basename(projectRoot);
  }

  // Check for TypeScript
  try {
    await fs.access(path.join(projectRoot, 'tsconfig.json'));
    info.hasTypeScript = true;
  } catch {
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
  } catch {
    // no README
  }

  // Check for .env.example
  try {
    await fs.access(path.join(projectRoot, '.env.example'));
    info.hasEnvExample = true;
  } catch {
    // no .env.example
  }

  // Check for Docker files
  try {
    await fs.access(path.join(projectRoot, 'Dockerfile'));
    info.hasDocker = true;
  } catch {
    // no Dockerfile
  }
  if (!info.hasDocker) {
    try {
      await fs.access(path.join(projectRoot, 'docker-compose.yml'));
      info.hasDocker = true;
    } catch {
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
        } catch {
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
    } catch {
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
  } catch {
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
