import { categoriseFiles, buildSummary } from './diffNarrator';

const FIXTURE_FILES = [
  'src/main/ipc/chat.ts',
  'src/renderer/src/components/InputBar.tsx',
  'src/shared/types.ts',
  'cli/src/commands/chat.ts',
  'package.json',
  'SELF_EVOLVE/JOURNAL.md',
];

const cats = categoriseFiles(FIXTURE_FILES);
const summary = buildSummary(cats, 6, 47, 12);

if (cats['Backend (main process)']?.length !== 1) throw new Error('Backend categorisation wrong');
if (cats['Renderer / UI']?.length !== 1) throw new Error('Renderer categorisation wrong');
if (cats['CLI']?.length !== 1) throw new Error('CLI categorisation wrong');
if (summary.includes('6 files changed')) console.log('## pass: diffNarrator categorisation + summary');