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
console.log('agentMemory.test.ts — all assertions passed');
