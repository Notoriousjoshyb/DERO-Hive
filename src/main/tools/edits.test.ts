import assert from 'node:assert/strict';
import { applyEdits, parseEditArgs } from './edits';

const SRC = [
  'const a = 1;',
  'const b = 2;',
  'const c = 2;',
  'export { a, b, c };'
].join('\n');

// ── single hunk ──────────────────────────────────────────────────────────
{
  const r = applyEdits(SRC, [{ oldText: 'const a = 1;', newText: 'const a = 42;' }]);
  assert.ok(r.ok);
  assert.match(r.text, /const a = 42;/);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].line, 1, 'first line of the file is line 1');
}

// ── several hunks apply in order ─────────────────────────────────────────
{
  const r = applyEdits(SRC, [
    { oldText: 'const a = 1;', newText: 'const a = 10;' },
    { oldText: 'export { a, b, c };', newText: 'export { a };' }
  ]);
  assert.ok(r.ok);
  assert.match(r.text, /const a = 10;/);
  assert.match(r.text, /export \{ a \};/);
  assert.equal(r.applied[1].line, 4);
}

// ── a later hunk sees the earlier result ─────────────────────────────────
{
  const r = applyEdits(SRC, [
    { oldText: 'const a = 1;', newText: 'const a = 99;' },
    { oldText: 'const a = 99;', newText: 'const a = 100;' }
  ]);
  assert.ok(r.ok);
  assert.match(r.text, /const a = 100;/);
}

// ── atomic: one bad hunk discards the whole call ─────────────────────────
{
  const r = applyEdits(SRC, [
    { oldText: 'const a = 1;', newText: 'const a = 7;' },
    { oldText: 'const NOPE = 0;', newText: 'x' }
  ]);
  assert.ok(!r.ok);
  assert.equal(r.failedHunk, 2);
  assert.match(r.error, /No edits were applied/);
  // The first hunk's success must not have escaped anywhere.
  assert.match(r.error, /old_text not found/);
}

// ── ambiguous match is refused unless replace_all ────────────────────────
{
  const ambiguous = applyEdits(SRC, [{ oldText: ' = 2;', newText: ' = 3;' }]);
  assert.ok(!ambiguous.ok);
  assert.match(ambiguous.error, /matches 2 locations/);

  const all = applyEdits(SRC, [{ oldText: ' = 2;', newText: ' = 3;', replaceAll: true }]);
  assert.ok(all.ok);
  assert.equal(all.applied[0].replaced, 2);
  assert.equal(all.text.split(' = 3;').length - 1, 2);
}

// ── `$&` in new_text is written literally, not as a regex reference ──────
{
  const r = applyEdits('value: X', [{ oldText: 'X', newText: '$& and $\'' }]);
  assert.ok(r.ok);
  assert.equal(r.text, "value: $& and $'");
}

// ── empty and no-op hunks are errors, not silent successes ───────────────
{
  assert.ok(!applyEdits(SRC, []).ok);
  assert.ok(!applyEdits(SRC, [{ oldText: '', newText: 'x' }]).ok);
  const noop = applyEdits(SRC, [{ oldText: 'const a = 1;', newText: 'const a = 1;' }]);
  assert.ok(!noop.ok);
  assert.match(noop.error, /identical/);
}

// ── argument parsing accepts both forms ──────────────────────────────────
{
  const arrayForm = parseEditArgs({ edits: [{ old_text: 'a', new_text: 'b', replace_all: true }] });
  assert.deepEqual(arrayForm, [{ oldText: 'a', newText: 'b', replaceAll: true }]);

  const singleForm = parseEditArgs({ old_text: 'a', new_text: 'b' });
  assert.deepEqual(singleForm, [{ oldText: 'a', newText: 'b', replaceAll: false }]);

  assert.equal(parseEditArgs({ path: 'x' }), null, 'neither form present must be reported, not guessed');
}

console.log('edits.test.ts passed');
