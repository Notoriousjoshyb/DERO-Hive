import assert from 'node:assert/strict';
import { buildSummary, categoriseFiles } from './diffNarrator';

const files = [
  'src/main/ipc/chat.ts',
  'src/renderer/src/App.tsx',
  'src/shared/types.ts',
  'cli/src/index.ts',
  'package.json',
  'SELF_EVOLVE/JOURNAL.md',
  'notes.txt'
];
const categories = categoriseFiles(files);
assert.equal(Object.values(categories).flat().length, files.length);
assert.deepEqual(categories['Backend (main process)'], ['src/main/ipc/chat.ts']);
assert.deepEqual(categories['Renderer / UI'], ['src/renderer/src/App.tsx']);
assert.deepEqual(categories['Shared types & utilities'], ['src/shared/types.ts']);
assert.deepEqual(categories.CLI, ['cli/src/index.ts']);
assert.deepEqual(categories['Config & build'], ['package.json']);
assert.deepEqual(categories['Self-evolve'], ['SELF_EVOLVE/JOURNAL.md']);
assert.deepEqual(categories.Other, ['notes.txt']);

assert.equal(buildSummary({}, 0, 0, 0), 'No files changed.');
assert.match(buildSummary({ CLI: ['cli/src/index.ts'] }, 1, 2, 1), /^1 file changed in cli\./);
const summary = buildSummary(categories, files.length, 47, 12);
assert.match(summary, /7 files changed across 7 areas/);
assert.match(summary, /Net \+47 \/ -12 lines/);

console.log('diffNarrator tests passed');
