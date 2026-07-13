import assert from 'node:assert/strict';
import * as memoryUtils from './agentMemory.js';
import type { AgentMemoryEntry } from './agentMemory.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 13);
const memory = (id: string, content: string, overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry => ({
  id,
  content,
  createdAt: NOW,
  ...overrides
});

// Cycle 221: memory text is normalized for stable retrieval across formatting differences.
assert.equal(memoryUtils.normalizeMemoryText('  DERO\n\tHive  '), 'dero hive');
assert.equal(memoryUtils.normalizeMemoryText('ＦＵＬＬＷＩＤＴＨ'), 'fullwidth');

// Subsequent cycle fixtures intentionally live beside the first regression.
assert.equal(DAY, 86_400_000);
assert.equal(memory('fixture', 'ready').content, 'ready');

// Cycle 222: Unicode-aware tokenization retains useful DERO identifiers.
assert.deepEqual(memoryUtils.tokenizeMemoryText('Deploy wallet_rpc v2 — café 42!'), ['deploy', 'wallet_rpc', 'v2', 'café', '42']);
assert.deepEqual(memoryUtils.tokenizeMemoryText('  !!!  '), []);

// Cycle 271: tokenization is Unicode-aware and keeps useful intra-token separators.
assert.deepEqual(
  memoryUtils.tokenizeMemoryText("Déro_hive's RPC-v2 + １２３"),
  ["déro_hive's", 'rpc-v2', '123']
);
// Cycle 272: tags are normalized, de-duplicated, and returned deterministically.
const cycle272Tags = memoryUtils.mergeMemoryTags([' #DERO ', 'local first'], ['dero', 'AI']);
assert.equal(cycle272Tags.length, 3);
assert.equal(cycle272Tags.includes('ai'), true);
assert.equal(cycle272Tags.includes('dero'), true);
assert.equal(cycle272Tags.includes('local-first'), true);
// Cycle 273: fingerprints ignore formatting drift while isolating empty entries.
assert.equal(memoryUtils.memoryFingerprint({ id: 'a', content: ' A\n B ' }), 'a b');
assert.equal(memoryUtils.memoryFingerprint({ id: 'empty-a', content: '   ' }), 'empty:empty-a');
// Cycle 274: lexical similarity handles identical, disjoint, and partial token sets.
assert.equal(memoryUtils.jaccardSimilarity('dero hive', 'hive dero'), 1);
assert.equal(memoryUtils.jaccardSimilarity('dero', 'wallet'), 0);
assert.equal(memoryUtils.jaccardSimilarity('dero hive', 'hive wallet'), 1 / 3);
// Cycle 276: tag scoring reports the fraction of requested tags available.
assert.equal(memoryUtils.tagOverlapScore(['DERO', 'missing'], ['#dero', 'other']), 0.5);
assert.equal(memoryUtils.tagOverlapScore([], ['dero']), 0);
// Cycle 277: recency scoring follows its configured half-life and clamps future dates.
assert.equal(memoryUtils.memoryRecencyScore(NOW, NOW, 30), 1);
assert.equal(memoryUtils.memoryRecencyScore(NOW - 30 * DAY, NOW, 30), 0.5);
assert.equal(memoryUtils.memoryRecencyScore(NOW + DAY, NOW, 30), 1);
// Cycle 278: summaries remove control bytes and normalize whitespace.
assert.equal(memoryUtils.summarizeMemoryContent('alpha\u0000\n\tbeta'), 'alpha beta');
assert.equal(memoryUtils.summarizeMemoryContent('alpha', 0), '');
// Cycle 279: summaries prefer a readable word boundary and support a one-char limit.
assert.equal(memoryUtils.summarizeMemoryContent('alpha beta gamma', 12), 'alpha beta…');
assert.equal(memoryUtils.summarizeMemoryContent('alpha', 1), '…');
// Cycle 281: search parsing separates plain terms from exact phrases.
const cycle281Query = memoryUtils.parseMemorySearchQuery('wallet sync "exact phrase"');
assert.equal(cycle281Query.text, 'wallet sync');
assert.deepEqual(cycle281Query.phrases, ['exact phrase']);
// Cycle 282: escaped quotes survive phrase parsing without leaking into plain text.
const cycle282Query = memoryUtils.parseMemorySearchQuery('"quoted \\"value\\"" tail');
assert.deepEqual(cycle282Query.phrases, ['quoted "value"']);
assert.equal(cycle282Query.text, 'tail');
// Cycle 223: tags are normalized, deduplicated, and sorted for stable metadata.
assert.deepEqual(memoryUtils.mergeMemoryTags(['DERO', 'dero'], ['  agent memory  ', '#Hive']), ['agent-memory', 'dero', 'hive']);

// Cycle 283: tag/source filters normalize and de-duplicate values.
const cycle283Query = memoryUtils.parseMemorySearchQuery('tag:#DERO tag:local-first source:CLI source:cli');
assert.deepEqual(cycle283Query.tags, ['dero', 'local-first']);
assert.deepEqual(cycle283Query.sources, ['cli']);
// Cycle 284: valid date filters become timestamps while malformed dates stay unset.
const cycle284Query = memoryUtils.parseMemorySearchQuery('before:2026-07-14 after:2026-07-12');
assert.equal(cycle284Query.before, Date.parse('2026-07-14'));
assert.equal(cycle284Query.after, Date.parse('2026-07-12'));
assert.equal(memoryUtils.parseMemorySearchQuery('before:not-a-date').before, undefined);
// Cycle 286: every requested plain token must be present in memory content.
const cycle286Entries = [memory('a', 'DERO wallet sync'), memory('b', 'wallet only')];
assert.deepEqual(memoryUtils.filterMemories(cycle286Entries, 'wallet DERO').map((entry) => entry.id), ['a']);
// Cycle 287: quoted phrases require contiguous normalized content.
const cycle287Entries = [memory('a', 'wallet sync complete'), memory('b', 'wallet then sync')];
assert.deepEqual(memoryUtils.filterMemories(cycle287Entries, '"wallet sync"').map((entry) => entry.id), ['a']);
// Cycle 288: all requested tags must be present after normalization.
const cycle288Entries = [
  memory('a', 'one', { tags: ['DERO', 'local-first'] }),
  memory('b', 'two', { tags: ['DERO'] })
];
assert.deepEqual(memoryUtils.filterMemories(cycle288Entries, 'tag:dero tag:local-first').map((entry) => entry.id), ['a']);
// Cycle 289: source filters are normalized case-insensitively.
const cycle289Entries = [memory('a', 'one', { source: 'CLI' }), memory('b', 'two', { source: 'desktop' })];
assert.deepEqual(memoryUtils.filterMemories(cycle289Entries, 'source:cli').map((entry) => entry.id), ['a']);
// Cycle 291: before/after filters use strict timestamp boundaries.
const cycle291Entries = [
  memory('old', 'one', { createdAt: NOW - 2 * DAY }),
  memory('boundary', 'two', { createdAt: NOW - DAY }),
  memory('new', 'three', { createdAt: NOW })
];
assert.deepEqual(memoryUtils.filterMemories(cycle291Entries, { text: '', phrases: [], tags: [], sources: [], before: NOW - DAY }).map((entry) => entry.id), ['old']);
assert.deepEqual(memoryUtils.filterMemories(cycle291Entries, { text: '', phrases: [], tags: [], sources: [], after: NOW - DAY }).map((entry) => entry.id), ['new']);
// Cycle 292: lexical-only scoring yields a perfect score for identical token sets.
const cycle292Score = memoryUtils.scoreMemory(memory('a', 'DERO wallet'), 'wallet DERO', {
  now: NOW,
  weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 }
});
assert.equal(cycle292Score.lexicalScore, 1);
assert.equal(cycle292Score.score, 1);
// Cycle 293: pin-only scoring explicitly boosts pinned memories.
const cycle293Score = memoryUtils.scoreMemory(memory('a', 'unrelated', { pinned: true }), 'query', {
  now: NOW,
  weights: { lexical: 0, recency: 0, tags: 0, pinned: 1 }
});
assert.equal(cycle293Score.pinScore, 1);
assert.equal(cycle293Score.score, 1);
// Cycle 294: an all-zero weight override safely falls back to balanced defaults.
const cycle294Score = memoryUtils.scoreMemory(memory('a', 'same'), 'same', {
  now: NOW,
  weights: { lexical: 0, recency: 0, tags: 0, pinned: 0 }
});
assert.equal(Math.abs(cycle294Score.score - 0.75) < 1e-12, true);
// Cycle 296: ranking orders exact, partial, then unrelated lexical matches.
const cycle296Ranked = memoryUtils.rankMemories(
  [memory('partial', 'dero wallet'), memory('exact', 'dero wallet sync'), memory('none', 'other')],
  'dero wallet sync',
  { now: NOW, weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 } }
);
assert.deepEqual(cycle296Ranked.map(({ entry }) => entry.id), ['exact', 'partial', 'none']);
// Cycle 297: equal scores break ties by freshness and then stable id order.
const cycle297ByDate = memoryUtils.rankMemories(
  [memory('old', 'same', { createdAt: NOW - DAY }), memory('new', 'same')],
  '',
  { now: NOW, weights: { lexical: 0, recency: 1, tags: 0, pinned: 0 } }
);
assert.deepEqual(cycle297ByDate.map(({ entry }) => entry.id), ['new', 'old']);
const cycle297ById = memoryUtils.rankMemories([memory('b', 'same'), memory('a', 'same')], '', { now: NOW });
assert.deepEqual(cycle297ById.map(({ entry }) => entry.id), ['a', 'b']);
// Cycle 298: source allow-lists and minimum scores compose deterministically.
const cycle298Entries = [memory('exact', 'dero wallet', { source: 'CLI' }), memory('partial', 'dero', { source: 'CLI' }), memory('desktop', 'dero wallet', { source: 'desktop' })];
const cycle298Ranked = memoryUtils.rankMemories(cycle298Entries, 'dero wallet', {
  now: NOW,
  sources: ['cli'],
  minScore: 0.75,
  weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 }
});
assert.deepEqual(cycle298Ranked.map(({ entry }) => entry.id), ['exact']);
// Cycle 299: result limits are floored and negative limits produce no results.
const cycle299Entries = Array.from({ length: 5 }, (_, index) => memory(String(index), 'same'));
assert.equal(memoryUtils.rankMemories(cycle299Entries, '', { limit: 2.9, now: NOW }).length, 2);
assert.equal(memoryUtils.rankMemories(cycle299Entries, '', { limit: -1, now: NOW }).length, 0);
// Cycle 331: tokenization of empty/whitespace input yields no tokens.
assert.deepEqual(memoryUtils.tokenizeMemoryText(''), []);
assert.deepEqual(memoryUtils.tokenizeMemoryText('   \t  '), []);
// Cycle 301: duplicate normalized content keeps the newest memory.
const cycle301Deduped = memoryUtils.deduplicateMemories([
  memory('old', ' DERO\nHive ', { createdAt: NOW - DAY }),
  memory('new', 'dero hive', { createdAt: NOW })
]);
assert.deepEqual(cycle301Deduped.map((entry) => entry.id), ['new']);
// Cycle 332: tokenization breaks on common ASCII punctuation while keeping alphanumerics.
assert.deepEqual(memoryUtils.tokenizeMemoryText('hello,world.foo;bar'), ['hello', 'world', 'foo', 'bar']);
// Cycle 302: a pinned duplicate wins even when an unpinned duplicate is newer.
const cycle302Deduped = memoryUtils.deduplicateMemories([
  memory('pinned', 'same', { createdAt: NOW - DAY, pinned: true }),
  memory('new', 'same', { createdAt: NOW })
]);
assert.deepEqual(cycle302Deduped.map((entry) => entry.id), ['pinned']);
console.log('agentMemory.test.ts — all assertions passed');
