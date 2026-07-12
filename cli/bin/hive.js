#!/usr/bin/env node
// DERO Hive CLI runtime wrapper. Uses tsx to run TypeScript source directly,
// so the CLI can import the existing Electron main modules without requiring
// a full bundler or .js extension rewrites.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
// Keep the terminal's original cwd as the coding workspace. Source imports
// resolve by URL, while these variables point headless services at Hive's
// bundled resources instead of whichever VS Code folder launched the CLI.
process.env.HIVE_LAUNCH_CWD ||= process.cwd();
process.env.HIVE_APP_ROOT ||= root;
process.env.HIVE_RESOURCES ||= resolve(root, 'resources');
process.env.HIVE_CLI = '1';
const builtEntry = resolve(__dirname, '..', 'dist', 'hive.mjs');
if (existsSync(builtEntry)) {
  import(pathToFileURL(builtEntry).href);
} else {
  import('tsx').then(() => import('../src/index.ts'));
}
