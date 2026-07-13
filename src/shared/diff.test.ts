import assert from 'node:assert/strict';
import { diffLines, diffCounts, collapseContext } from './diff';

const filler = 'context line with sufficient length to pass any content-length guards in the artifact extractor';

// ─── diffLines ────────────────────────────────────────────────────────────

const same = diffLines('hello\nworld', 'hello\nworld');
assert.equal(same.length, 2);
assert.equal(same.filter((l) => l.op !== 'context').length, 0);
assert.equal(same[0].oldLineNo, 1);
assert.equal(same[0].newLineNo, 1);

const added = diffLines('line a\nline b', 'line a\nline b\nline c');
assert.equal(added.length, 3);
const addOps = added.filter((l) => l.op === 'add');
assert.equal(addOps.length, 1);
assert.equal(addOps[0].text, 'line c');
assert.equal(addOps[0].newLineNo, 3);
assert.equal(addOps[0].oldLineNo, undefined);

const deleted = diffLines('line a\nline b\nline c', 'line a\nline c');
assert.equal(deleted.length, 3);
const delOps = deleted.filter((l) => l.op === 'del');
assert.equal(delOps.length, 1);
assert.equal(delOps[0].text, 'line b');
assert.equal(delOps[0].oldLineNo, 2);
assert.equal(delOps[0].newLineNo, undefined);

const changed = diffLines('first\nsecond\nthird', 'first\nmodified\nthird');
assert.equal(changed.filter((l) => l.op === 'del').length, 1);
assert.equal(changed.filter((l) => l.op === 'add').length, 1);

// empty / single-line
const emptyOld = diffLines('', 'new line');
assert.equal(emptyOld.length, 1);
assert.equal(emptyOld[0].op, 'add');

const emptyNew = diffLines('old line', '');
assert.equal(emptyNew.length, 1);
assert.equal(emptyNew[0].op, 'del');

// both empty
const bothEmpty = diffLines('', '');
assert.equal(bothEmpty.length, 0);

// custom line offsets
const offset = diffLines('old', 'new', { oldStart: 10, newStart: 20 });
assert.equal(offset[0].oldLineNo, 10); // deletion from old
assert.equal(offset[0].newLineNo, undefined);
assert.equal(offset[1].newLineNo, 20); // addition in new
assert.equal(offset[1].oldLineNo, undefined);

// cap (4000+ lines) — fallback emits all lines as add/del
const bigOld = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join('\n');
const bigNew = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join('\n');
const bigDiff = diffLines(bigOld, bigNew);
assert.equal(bigDiff.length, 8002); // all deleted + all added

// ─── diffCounts ───────────────────────────────────────────────────────────

assert.deepEqual(diffCounts([]), { added: 0, removed: 0 });

const mixed = diffLines('a\nb\nc\nd', 'a\nx\nc\ny');
const counts = diffCounts(mixed);
assert.equal(counts.added, 2);
assert.equal(counts.removed, 2);

// ─── collapseContext ──────────────────────────────────────────────────────

const noChanges = diffLines(`${filler}a`, `${filler}a`);
assert.equal(collapseContext(noChanges, 3).length, 0);

const oneHunk = diffLines(`before\n${filler}\nafter`, `before\n${filler} modified\nafter`);
const collapsed = collapseContext(oneHunk, 1);
assert.ok(collapsed.some((l) => l.op === 'add' || l.op === 'del'));
assert.ok(collapsed.some((l) => l.op === 'context'));

console.log('diff tests passed');
