import assert from 'node:assert/strict';
import * as memoryUtils from './agentMemory.js';
import type { AgentMemoryEntry, RankedMemory } from './agentMemory.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 13); // 2026-07-13

const mem = (id: string, content: string, overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry => ({
  id,
  content,
  createdAt: NOW,
  ...overrides
});

let failures = 0;
function t(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

// ── mergeMemoryTags ────────────────────────────────────────────────
t('mergeMemoryTags: dedupes and normalises', () => {
  assert.deepEqual(memoryUtils.mergeMemoryTags(['DERO', 'dero', '   Hive   ']), ['dero', 'hive']);
});

t('mergeMemoryTags: drops empty tags after normalisation', () => {
  assert.deepEqual(memoryUtils.mergeMemoryTags(['a', '', '   ']), ['a']);
});

t('mergeMemoryTags: sorted alphabetically', () => {
  assert.deepEqual(memoryUtils.mergeMemoryTags(['beta', 'alpha', 'Gamma']), ['alpha', 'beta', 'gamma']);
});

// ── memoryFingerprint ──────────────────────────────────────────────
t('memoryFingerprint: hash for content with letters', () => {
  assert.equal(memoryUtils.memoryFingerprint({ id: 'x', content: 'Hello World' }), 'hello world');
});

t('memoryFingerprint: falls back to id when content empty after normalisation', () => {
  assert.equal(memoryUtils.memoryFingerprint({ id: '42', content: '   ' }), 'empty:42');
});

// ── jaccardSimilarity ──────────────────────────────────────────────
t('jaccardSimilarity: identical strings have score 1', () => {
  assert.equal(memoryUtils.jaccardSimilarity('hello world', 'hello world'), 1);
});

t('jaccardSimilarity: zero overlap = 0', () => {
  assert.equal(memoryUtils.jaccardSimilarity('hello', 'world'), 0);
});

t('jaccardSimilarity: partial overlap', () => {
  // tokens "a b c" and "b c d" → 2/4 = 0.5
  assert.equal(memoryUtils.jaccardSimilarity('a b c', 'b c d'), 0.5);
});

t('jaccardSimilarity: empty side = 0', () => {
  assert.equal(memoryUtils.jaccardSimilarity('', 'hello'), 0);
  assert.equal(memoryUtils.jaccardSimilarity('hello', ''), 0);
});

// ── tagOverlapScore ────────────────────────────────────────────────
t('tagOverlapScore: full match = 1', () => {
  assert.equal(memoryUtils.tagOverlapScore(['DERO', 'Hive'], ['dero', 'hive']), 1);
});

t('tagOverlapScore: zero overlap = 0', () => {
  assert.equal(memoryUtils.tagOverlapScore(['a', 'b'], ['c', 'd']), 0);
});

t('tagOverlapScore: empty query = 0', () => {
  assert.equal(memoryUtils.tagOverlapScore([], ['anything']), 0);
});

t('tagOverlapScore: handles undefined memory tags', () => {
  assert.equal(memoryUtils.tagOverlapScore(['a']), 0);
});

// ── memoryRecencyScore ─────────────────────────────────────────────
t('memoryRecencyScore: now = 1', () => {
  assert.equal(memoryUtils.memoryRecencyScore(NOW, NOW), 1);
});

t('memoryRecencyScore: half-life halves the score', () => {
  const half = 30 * DAY;
  assert.ok(Math.abs(memoryUtils.memoryRecencyScore(NOW - half, NOW, 30) - 0.5) < 1e-9);
});

t('memoryRecencyScore: far past → near 0', () => {
  assert.ok(memoryUtils.memoryRecencyScore(0, NOW, 30) < 0.001);
});

t('memoryRecencyScore: non-finite timestamp returns 0', () => {
  assert.equal(memoryUtils.memoryRecencyScore(NaN, NOW), 0);
});

t('memoryRecencyScore: non-positive half-life falls back to 30', () => {
  assert.equal(memoryUtils.memoryRecencyScore(NOW, NOW, 0), 1);
});

// ── summarizeMemoryContent ─────────────────────────────────────────
t('summarizeMemoryContent: short string passes through trimmed', () => {
  assert.equal(memoryUtils.summarizeMemoryContent('  hello world  ', 100), 'hello world');
});

t('summarizeMemoryContent: long content trims on word boundary', () => {
  const long = 'a'.repeat(50) + ' ' + 'b'.repeat(50) + ' ' + 'c'.repeat(50);
  const out = memoryUtils.summarizeMemoryContent(long, 60);
  assert.ok(out.length <= 60, `len=${out.length}`);
  assert.ok(out.endsWith('…'));
});

t('summarizeMemoryContent: maxChars=0 returns empty', () => {
  assert.equal(memoryUtils.summarizeMemoryContent('hello', 0), '');
});

t('summarizeMemoryContent: strips control characters but collapses adjacent runs', () => {
  // Control chars are dropped; adjacent alphanumerics then merge.
  assert.equal(memoryUtils.summarizeMemoryContent('a\x01b\x05c d'), 'abc d');
});

t('summarizeMemoryContent: maxChars=1 returns ellipsis', () => {
  assert.equal(memoryUtils.summarizeMemoryContent('hi there', 1), '…');
});

// ── parseMemorySearchQuery ─────────────────────────────────────────
t('parseMemorySearchQuery: plain text tokens', () => {
  const q = memoryUtils.parseMemorySearchQuery('hello world');
  assert.equal(q.text, 'hello world');
  assert.deepEqual(q.tags, []);
  assert.deepEqual(q.phrases, []);
});

t('parseMemorySearchQuery: phrases recognised via "quoted"', () => {
  const q = memoryUtils.parseMemorySearchQuery('"hello world" foo');
  assert.deepEqual(q.phrases, ['hello world']);
  assert.equal(q.text, 'foo');
});

t('parseMemorySearchQuery: tag: filters', () => {
  const q = memoryUtils.parseMemorySearchQuery('tag:dero foo tag:Hive');
  assert.deepEqual(q.tags, ['dero', 'hive']);
  assert.equal(q.text, 'foo');
});

t('parseMemorySearchQuery: source: filters', () => {
  const q = memoryUtils.parseMemorySearchQuery('source:cli bar');
  assert.deepEqual(q.sources, ['cli']);
  assert.equal(q.text, 'bar');
});

t('parseMemorySearchQuery: before:/after: parse to timestamps', () => {
  const q = memoryUtils.parseMemorySearchQuery('before:2026-01-01 after:2025-01-01');
  assert.ok(typeof q.before === 'number' && q.before > 0);
  assert.ok(typeof q.after === 'number' && q.after > 0);
  assert.ok(q.before > q.after);
});

t('parseMemorySearchQuery: invalid before: silently ignored', () => {
  const q = memoryUtils.parseMemorySearchQuery('before:totally-not-a-date');
  assert.equal(q.before, undefined);
});

// ── filterMemories ────────────────────────────────────────────────
t('filterMemories: text token must appear', () => {
  const e1 = mem('a', 'hello world');
  const e2 = mem('b', 'goodbye sky');
  const out = memoryUtils.filterMemories([e1, e2], { text: 'world', phrases: [], tags: [], sources: [] });
  assert.deepEqual(out.map((e) => e.id), ['a']);
});

t('filterMemories: phrase must appear in normalised content', () => {
  const e1 = mem('a', 'HelloWorld');
  const out = memoryUtils.filterMemories([e1], { text: '', phrases: ['helloworld'], tags: [], sources: [] });
  assert.equal(out.length, 1);
});

t('filterMemories: required tags filter', () => {
  const e1 = mem('a', 'hi', { tags: ['DERO'] });
  const e2 = mem('b', 'hi', { tags: [] });
  const out = memoryUtils.filterMemories([e1, e2], { text: 'hi', phrases: [], tags: ['dero'], sources: [] });
  assert.deepEqual(out.map((e) => e.id), ['a']);
});

t('filterMemories: source filter', () => {
  const e1 = mem('a', 'hi', { source: 'cli' });
  const e2 = mem('b', 'hi', { source: 'main' });
  const out = memoryUtils.filterMemories([e1, e2], { text: 'hi', phrases: [], tags: [], sources: ['cli'] });
  assert.deepEqual(out.map((e) => e.id), ['a']);
});

t('filterMemories: before/after window', () => {
  const old = mem('a', 'hi', { createdAt: NOW - 100 * DAY });
  const middle = mem('b', 'hi', { createdAt: NOW - 30 * DAY });
  const recent = mem('c', 'hi', { createdAt: NOW - DAY });
  const before = NOW - 10 * DAY;
  const after = NOW - 50 * DAY;
  const out = memoryUtils.filterMemories([old, middle, recent], { text: '', phrases: [], tags: [], sources: [], before, after });
  assert.deepEqual(out.map((e) => e.id), ['b']);
});

// ── scoreMemory / rankMemories ─────────────────────────────────────
t('scoreMemory: pinned memory always scores ≥ non-pinned', () => {
  const plain = mem('a', 'hello world');
  const stuck = mem('b', 'hello world', { pinned: true });
  const ra = memoryUtils.scoreMemory(plain, 'hello', { now: NOW });
  const rb = memoryUtils.scoreMemory(stuck, 'hello', { now: NOW });
  assert.ok(rb.score >= ra.score);
});

t('rankMemories: returns sorted by descending score', () => {
  const entries = [
    mem('a', 'unrelated content'),
    mem('b', 'hello world hello world hello world'),
    mem('c', 'hello world extra')
  ];
  const ranked = memoryUtils.rankMemories(entries, 'hello world', { now: NOW, limit: 10 });
  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].score >= ranked[1].score);
});

t('rankMemories: limit cap respected', () => {
  const entries = [mem('a', 'hello'), mem('b', 'hello'), mem('c', 'hello')];
  const ranked = memoryUtils.rankMemories(entries, 'hello', { now: NOW, limit: 2 });
  assert.equal(ranked.length, 2);
});

t('rankMemories: source filter applied', () => {
  const entries = [
    mem('a', 'hello', { source: 'cli' }),
    mem('b', 'hello', { source: 'main' })
  ];
  const ranked = memoryUtils.rankMemories(entries, 'hello', { sources: ['cli'], now: NOW });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].entry.id, 'a');
});

t('rankMemories: score tie broken by updatedAt then id', () => {
  const entries = [
    mem('aaa', 'hello hello', { updatedAt: NOW }),
    mem('zzz', 'hello hello', { updatedAt: NOW })
  ];
  const ranked = memoryUtils.rankMemories(entries, 'hello', { now: NOW, limit: 10 });
  // Same score, same timestamp → alphabetical id asc
  assert.equal(ranked[0].entry.id, 'aaa');
  assert.equal(ranked[1].entry.id, 'zzz');
});

// ── deduplicateMemories ────────────────────────────────────────────
t('deduplicateMemories: merges identical content keeping pinned', () => {
  const a = mem('a', 'hello', { pinned: false });
  const b = mem('b', 'Hello', { pinned: true });
  const out = memoryUtils.deduplicateMemories([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].pinned, true);
});

t('deduplicateMemories: keeps most recent when neither pinned', () => {
  const old = mem('a', 'hello', { createdAt: NOW - 1000 });
  const recent = mem('b', 'Hello', { createdAt: NOW });
  const out = memoryUtils.deduplicateMemories([old, recent]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'b');
});

t('deduplicateMemories: distinct content preserved', () => {
  const a = mem('a', 'hello');
  const b = mem('b', 'goodbye');
  const out = memoryUtils.deduplicateMemories([a, b]);
  assert.equal(out.length, 2);
});

// ── estimateMemoryTokens / selectMemoriesForBudget ─────────────────
t('estimateMemoryTokens: empty string = 0', () => {
  assert.equal(memoryUtils.estimateMemoryTokens(''), 0);
});

t('estimateMemoryTokens: 4 chars per token ceiling', () => {
  // 9 chars → ceil(9/4) = 3
  assert.equal(memoryUtils.estimateMemoryTokens('abcdefghi'), 3);
});

t('selectMemoriesForBudget: respects budget', () => {
  const ranked: RankedMemory[] = [
    { entry: mem('a', 'hello world'), score: 1, lexicalScore: 1, recencyScore: 1, tagScore: 0, pinScore: 0 },
    { entry: mem('b', 'hello world'), score: 0.5, lexicalScore: 0.5, recencyScore: 1, tagScore: 0, pinScore: 0 }
  ];
  // Each summariseMemoryContent of "hello world" fits well under small budget
  const out = memoryUtils.selectMemoriesForBudget(ranked, 1000);
  assert.equal(out.length, 2);
});

t('selectMemoriesForBudget: zero budget yields empty', () => {
  const ranked: RankedMemory[] = [
    { entry: mem('a', 'hello world'), score: 1, lexicalScore: 1, recencyScore: 1, tagScore: 0, pinScore: 0 }
  ];
  assert.equal(memoryUtils.selectMemoriesForBudget(ranked, 0).length, 0);
});

t('selectMemoriesForBudget: clamps negative budget to 0', () => {
  const ranked: RankedMemory[] = [
    { entry: mem('a', 'hello world'), score: 1, lexicalScore: 1, recencyScore: 1, tagScore: 0, pinScore: 0 }
  ];
  assert.equal(memoryUtils.selectMemoriesForBudget(ranked, -5).length, 0);
});

// ── buildMemoryContext ─────────────────────────────────────────────
t('buildMemoryContext: empty entries → empty or marker string', () => {
  const ctx = memoryUtils.buildMemoryContext([], 'hello');
  assert.equal(typeof ctx, 'string');
  assert.ok(ctx.length === 0 || ctx.includes('No relevant memories') || ctx.includes('No memories'));
});

t('buildMemoryContext: produces formatted block with selected memories', () => {
  const entries = [
    mem('a', 'hello world hello', { createdAt: NOW, tags: ['memory'] })
  ];
  const ctx = memoryUtils.buildMemoryContext(entries, 'hello', { now: NOW, tokenBudget: 200, maxContentChars: 240 });
  assert.ok(typeof ctx === 'string' && ctx.length > 0);
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall assertions passed');
