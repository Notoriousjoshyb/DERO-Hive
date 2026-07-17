import assert from 'node:assert/strict';
import { diffLines, collapseContext, type DiffLine } from './diff';

// ── diffLines ──────────────────────────────────────────────

const singleAdd = diffLines('', 'hello');
assert.equal(singleAdd.length, 1);
assert.equal(singleAdd[0].op, 'add');
assert.equal(singleAdd[0].text, 'hello');

const singleDel = diffLines('hello', '');
assert.equal(singleDel.length, 1);
assert.equal(singleDel[0].op, 'del');

const noChange = diffLines('hello', 'hello');
assert.equal(noChange.length, 1);
assert.equal(noChange[0].op, 'context');

// diff detects: a (context) -> b (del) -> x (add) -> c (context)
const multiLine = diffLines('a\nb\nc', 'a\nx\nc');
assert.ok(multiLine.length >= 3, `Expected >=3 lines, got ${multiLine.length}`);
assert.equal(multiLine[0].op, 'context');
assert.equal(multiLine[0].text, 'a');

// ── collapseContext ─────────────────────────────────────────

const lines: DiffLine[] = [
  { op: 'context', text: 'keep1', oldLineNo: 1, newLineNo: 1 },
  { op: 'context', text: 'keep2', oldLineNo: 2, newLineNo: 2 },
  { op: 'del', text: 'removed', oldLineNo: 3, newLineNo: undefined },
  { op: 'add', text: 'added', oldLineNo: undefined, newLineNo: 3 },
  { op: 'context', text: 'keep3', oldLineNo: 4, newLineNo: 4 },
  { op: 'context', text: 'keep4', oldLineNo: 5, newLineNo: 5 },
];
const collapsed = collapseContext(lines, 1);
assert.ok(collapsed.length > 0);
assert.ok(collapsed.length < lines.length, 'collapseContext should reduce line count');

// Non-empty diff input with mixed ops
const mixed = diffLines('a\nb\nc\nd\ne', 'a\nx\nc\ny\ne');
const collapsed2 = collapseContext(mixed, 2);
assert.ok(collapsed2.length > 0);
const ops = new Set(collapsed2.map((l: DiffLine) => l.op));
assert.ok(ops.has('context'), 'Should have context lines');

// Edge: single-line change
const edgeLine = diffLines('x', 'y');
const collapsed3 = collapseContext(edgeLine, 1);
assert.ok(collapsed3.length >= 1);

console.log('diffCollapse tests passed');
