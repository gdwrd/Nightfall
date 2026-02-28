import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve workspace packages directly to their TypeScript source. */
const workspacePlugin = {
  name: 'workspace-resolve',
  setup(b) {
    b.onResolve({ filter: /^@nightfall\/shared$/ }, () => ({
      path: path.resolve(__dirname, '../shared/src/index.ts'),
    }));
    b.onResolve({ filter: /^@nightfall\/core$/ }, () => ({
      path: path.resolve(__dirname, '../core/src/index.ts'),
    }));
  },
};

await build({
  entryPoints: [path.resolve(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: path.resolve(__dirname, 'dist/index.js'),
  banner: { js: '#!/usr/bin/env node' },
  external: [
    'ink',
    'ink-text-input',
    'react',
    'react/*',
    'ws',
    'ollama',
    'js-yaml',
    'diff',
  ],
  plugins: [workspacePlugin],
  treeShaking: true,
  sourcemap: true,
});
