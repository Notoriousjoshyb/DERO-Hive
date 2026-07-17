import assert from 'node:assert/strict';
import { emptyLiveUsage, applyUsageReport, reportCost } from './usageAccumulator';

// ─── emptyLiveUsage ─────────────────────────────────────────────────────
assert.deepEqual(emptyLiveUsage(), { promptTokens: 0, completionTokens: 0, cachedTokens: 0, reports: 0 });

// ─── reportCost ─────────────────────────────────────────────────────────
assert.equal(reportCost({ promptTokens: 0, completionTokens: 0 }), undefined, 'no prices → undefined');
assert.equal(reportCost({ promptTokens: 1000, completionTokens: 500 }, {}), undefined, 'empty prices → undefined');
// $3/1M in, $15/1M out: 2_000_000 in = $6, 1_000_000 out = $15
assert.equal(reportCost({ promptTokens: 2_000_000, completionTokens: 1_000_000 }, { input: 3, output: 15 }), 21);
// input-only pricing still prices the prompt half
assert.equal(reportCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, { input: 1 }), 1);
assert.equal(reportCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, { output: 2 }), 2);

// ─── applyUsageReport accumulates (does not replace) ────────────────────
// Simulates a two-round agentic turn: each round's provider report folds in.
let acc = emptyLiveUsage();
acc = applyUsageReport(acc, { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 }, { input: 3, output: 15 });
acc = applyUsageReport(acc, { promptTokens: 2500, completionTokens: 800, totalTokens: 3300, cachedTokens: 1000 }, { input: 3, output: 15 });
assert.equal(acc.promptTokens, 3700);
assert.equal(acc.completionTokens, 1100);
assert.equal(acc.cachedTokens, 1000);
assert.equal(acc.reports, 2);
// expected: (1200*3 + 300*15)/1e6 + (2500*3 + 800*15)/1e6 = 0.0081 + 0.0195
assert.ok(Math.abs((acc.estimatedCost ?? 0) - 0.0276) < 1e-12, `cost ${acc.estimatedCost}`);

// ─── cachedTokens optional / undefined-safe ─────────────────────────────
let noCache = emptyLiveUsage();
noCache = applyUsageReport(noCache, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
assert.equal(noCache.cachedTokens, 0, 'missing cachedTokens counts as 0');
assert.equal(noCache.estimatedCost, undefined, 'unpriced report leaves estimatedCost unset');

// ─── mixed priced/unpriced reports keep prior cost ──────────────────────
let mixed = emptyLiveUsage();
mixed = applyUsageReport(mixed, { promptTokens: 1_000_000, completionTokens: 0 }, { input: 2 });
assert.equal(mixed.estimatedCost, 2);
mixed = applyUsageReport(mixed, { promptTokens: 500, completionTokens: 500 }); // fallback model, no prices
assert.equal(mixed.estimatedCost, 2, 'unpriced report must not wipe accumulated cost');
assert.equal(mixed.promptTokens, 1_000_500);
assert.equal(mixed.reports, 2);

console.log('usageAccumulator.test.ts — all assertions passed');
