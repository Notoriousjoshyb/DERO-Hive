import assert from 'node:assert/strict';
import { lintDvmBasic } from './dvm';

// ─── lintDvmBasic — empty input ───────────────────────────────────────────

const empty = lintDvmBasic('');
assert.equal(empty.valid, false);
assert.ok(empty.findings.some((f) => f.code === 'NO_FUNCTIONS'));

// ─── valid contract ───────────────────────────────────────────────────────

const valid = lintDvmBasic([
  'Function Initialize Public',
  '  10 STORE("owner", SIGNER())',
  '  20 RETURN',
  'End Function',
  '',
  'Function Transfer Public',
  '  10 IF SIGNER() == LOAD("owner") GOTO 30',
  '  20 RETURN "Not authorized"',
  '  30 SEND_DERO_TO_ADDRESS("dero1xyz", 100)',
  '  40 RETURN',
  'End Function'
].join('\n'));

assert.equal(valid.valid, true);
assert.equal(valid.functions.length, 2);
assert.equal(valid.functions[0].name, 'Initialize');
assert.equal(valid.functions[1].name, 'Transfer');

// ─── missing End Function ─────────────────────────────────────────────────

const unterminated = lintDvmBasic('Function Foo Public\n  10 RETURN\n');
assert.equal(unterminated.valid, false);
assert.ok(unterminated.findings.some((f) => f.code === 'UNTERMINATED_FUNCTION'));

// ─── no initializer ───────────────────────────────────────────────────────

const noInit = lintDvmBasic('Function Foo Public\n  10 RETURN\nEnd Function');
assert.equal(noInit.valid, false);
assert.ok(noInit.findings.some((f) => f.code === 'INITIALIZER_COUNT'));

// ─── orphan End Function ─────────────────────────────────────────────────

const orphan = lintDvmBasic('End Function');
assert.ok(orphan.findings.some((f) => f.code === 'ORPHAN_END_FUNCTION'));

// ─── nested function ──────────────────────────────────────────────────────

const nested = lintDvmBasic([
  'Function Initialize Public',
  '  Function Inner Public',
  '  End Function',
  '  10 RETURN',
  'End Function'
].join('\n'));
assert.ok(nested.findings.some((f) => f.code === 'NESTED_FUNCTION'));

// ─── line numbering ───────────────────────────────────────────────────────

const noLineNums = lintDvmBasic([
  'Function Initialize Public',
  '  RETURN',
  'End Function'
].join('\n'));
assert.ok(noLineNums.findings.some((f) => f.code === 'UNNUMBERED_STATEMENT'));

// ─── duplicate line numbers ───────────────────────────────────────────────

const dupLines = lintDvmBasic([
  'Function Initialize Public',
  '  10 STORE("a", 1)',
  '  10 STORE("b", 2)',
  '  20 RETURN',
  'End Function'
].join('\n'));
assert.ok(dupLines.findings.some((f) => f.code === 'DUPLICATE_LINE'));

// ─── missing RETURN ───────────────────────────────────────────────────────

const noReturn = lintDvmBasic([
  'Function Initialize Public',
  '  10 STORE("a", 1)',
  'End Function'
].join('\n'));
assert.ok(noReturn.findings.some((f) => f.code === 'MISSING_RETURN'));

// ─── transfer without SIGNER ──────────────────────────────────────────────

const noSigner = lintDvmBasic('Function Transfer Public\n  10 SEND_DERO_TO_ADDRESS("dero1x", 10)\n  20 RETURN\nEnd Function');
assert.ok(noSigner.findings.some((f) => f.code === 'TRANSFER_WITHOUT_SIGNER'));

// ─── GOTO target missing ──────────────────────────────────────────────────

const badGoto = lintDvmBasic('Function Foo Public\n  10 GOTO 999\n  20 RETURN\nEnd Function');
assert.ok(badGoto.findings.some((f) => f.code === 'MISSING_GOTO_TARGET'));

// ─── comments ─────────────────────────────────────────────────────────────

const commented = lintDvmBasic("' This is a comment\nFunction Initialize Public\n  10 RETURN\nEnd Function");
assert.equal(commented.findings.filter((f) => f.code === 'TOP_LEVEL_CONTENT').length, 0);

// ─── STORE/LOAD static keys ───────────────────────────────────────────────

const unobserved = lintDvmBasic('Function Foo Public\n  10 STORE("a", 1)\n  20 LOAD("b")\n  30 RETURN\nEnd Function');
assert.ok(unobserved.findings.some((f) => f.code === 'UNOBSERVED_STORAGE_KEY'));

console.log('dvm tests passed');
