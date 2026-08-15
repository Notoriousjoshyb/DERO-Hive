import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ripgrepPath, rgFiles, rgSearch } from './ripgrep';

// A fixture tree with the things that made the old JS implementation slow or
// wrong: a nested source file, an ignored directory, and a binary.
const root = mkdtempSync(join(tmpdir(), 'hive-rg-'));

function write(rel: string, body: string | Buffer): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

async function main(): Promise<void> {
  const bin = ripgrepPath();
  if (!bin) {
    // Platforms without a bundled binary fall back to the JS path in
    // builtin.ts; there is nothing to assert about rg here.
    console.log('ripgrep.test.ts — skipped (no bundled ripgrep for this platform)');
    return;
  }

  write('src/alpha.ts', 'export const NEEDLE_ONE = 1;\nconst other = 2;\n');
  write('src/nested/beta.ts', 'import { NEEDLE_ONE } from "../alpha";\n');
  write('src/notes.md', 'NEEDLE_ONE appears in docs too\n');
  write('node_modules/pkg/index.js', 'NEEDLE_ONE should never be searched\n');
  write('assets/blob.bin', Buffer.from([0, 1, 2, 0, 255, 0, 3]));

  // ── rgFiles ─────────────────────────────────────────────────────────────
  const ts = await rgFiles('**/*.ts', root, undefined);
  assert.notEqual(ts, null);
  const tsSet = new Set(ts!);
  assert.ok(tsSet.has('src/alpha.ts'), 'finds a top-level match');
  assert.ok(tsSet.has('src/nested/beta.ts'), 'recurses');
  assert.ok(!ts!.some((f) => f.includes('node_modules')), 'node_modules is excluded by default');
  assert.ok(ts!.every((f) => !f.includes('\\')), 'paths are normalized to forward slashes');

  const md = await rgFiles('**/*.md', root, undefined);
  assert.deepEqual(md, ['src/notes.md']);

  // no matches is an empty list, not an error (rg exits 1)
  assert.deepEqual(await rgFiles('**/*.nope', root, undefined), []);

  // ── rgSearch ────────────────────────────────────────────────────────────
  const hits = await rgSearch('NEEDLE_ONE', root, undefined, undefined, 50);
  assert.notEqual(hits, null);
  assert.ok(hits!.lines.length >= 3, 'finds matches across files');
  assert.ok(hits!.lines.every((l) => /^[^:]+:\d+:/.test(l)), 'emits file:line:content');
  assert.ok(!hits!.lines.some((l) => l.includes('node_modules')), 'does not search node_modules');
  assert.ok(!hits!.lines.some((l) => l.includes('blob.bin')), 'skips binary files');

  // include filter
  const tsOnly = await rgSearch('NEEDLE_ONE', root, '*.ts', undefined, 50);
  assert.ok(tsOnly!.lines.length >= 2);
  assert.ok(!tsOnly!.lines.some((l) => l.endsWith('.md') || l.includes('notes.md')), 'include filter applies');

  // caller-supplied ignore replaces the defaults
  const ignoringSrc = await rgSearch('NEEDLE_ONE', root, undefined, ['src'], 50);
  assert.ok(!ignoringSrc!.lines.some((l) => l.startsWith('src/')), 'a bare directory name excludes recursively');

  // ── caps ────────────────────────────────────────────────────────────────
  const capped = await rgSearch('NEEDLE_ONE', root, undefined, undefined, 2);
  assert.equal(capped!.lines.length, 2, 'result cap is honoured');
  assert.equal(capped!.truncated, true, 'and truncation is reported');

  const uncapped = await rgSearch('NEEDLE_ONE', root, undefined, undefined, 50);
  assert.equal(uncapped!.truncated, false, 'not truncated when under the cap');

  // no matches
  const none = await rgSearch('zzz_no_such_symbol_zzz', root, undefined, undefined, 10);
  assert.deepEqual(none, { lines: [], truncated: false });

  // ── a bad regex surfaces as an error, not as silent emptiness ───────────
  await assert.rejects(
    () => rgSearch('(unclosed', root, undefined, undefined, 10),
    /regex|parse|unclosed|error/i,
    'an invalid pattern must be reported so the model can fix it'
  );

  // ── the pattern never reaches a shell ───────────────────────────────────
  // Spawned with an argv array, so shell metacharacters are literal text.
  write('src/shell.ts', 'const x = "$(whoami)";\n');
  const literal = await rgSearch('\\$\\(whoami\\)', root, undefined, undefined, 10);
  assert.equal(literal!.lines.length, 1, 'shell metacharacters are matched literally');
  assert.ok(literal!.lines[0].includes('shell.ts'));

  console.log('ripgrep.test.ts — all assertions passed');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => rmSync(root, { recursive: true, force: true }));
