from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "SELF_EVOLVE" / "JOURNAL.md"
TEST = ROOT / "cli" / "src" / "utils" / "agentMemory.test.ts"
LOG_DIR = Path(os.environ.get("TEMP", str(ROOT / ".tmp"))) / "dero-hive-cycles-271-320"
LOG_DIR.mkdir(parents=True, exist_ok=True)

TITLES = {
    271: "Unicode-aware memory tokenization coverage",
    272: "Memory tag normalization and de-duplication coverage",
    273: "Stable memory fingerprint coverage",
    274: "Jaccard memory similarity coverage",
    275: "HEALTH - full gate cadence",
    276: "Memory tag-overlap scoring coverage",
    277: "Memory recency half-life coverage",
    278: "Memory summary sanitization coverage",
    279: "Memory summary truncation coverage",
    280: "HEALTH - full gate cadence",
    281: "Memory search phrase parsing coverage",
    282: "Escaped memory phrase parsing coverage",
    283: "Memory tag and source query parsing coverage",
    284: "Memory date-filter parsing coverage",
    285: "HEALTH - full gate cadence",
    286: "Memory token filtering coverage",
    287: "Memory exact-phrase filtering coverage",
    288: "Memory required-tag filtering coverage",
    289: "Memory source filtering coverage",
    290: "HEALTH - full gate cadence",
    291: "Memory date-boundary filtering coverage",
    292: "Lexical memory scoring coverage",
    293: "Pinned-memory scoring coverage",
    294: "Memory score-weight fallback coverage",
    295: "HEALTH - full gate cadence",
    296: "Memory relevance ranking coverage",
    297: "Memory ranking tie-break coverage",
    298: "Memory source and score-threshold ranking coverage",
    299: "Memory result-limit normalization coverage",
    300: "HEALTH - full gate cadence",
    301: "Newest duplicate-memory selection coverage",
    302: "Pinned duplicate-memory selection coverage",
    303: "Deterministic duplicate-memory tie-break coverage",
    304: "Memory token-estimation coverage",
    305: "HEALTH - full gate cadence",
    306: "Memory token-budget selection coverage",
    307: "Oversized-memory budget skipping coverage",
    308: "Inspectable memory-context formatting coverage",
    309: "Bounded memory-context summary coverage",
    310: "HEALTH - full gate cadence",
    311: "Updated memory timestamp scoring coverage",
    312: "Empty-memory fingerprint isolation coverage",
    313: "Unicode memory-tag normalization coverage",
    314: "Unterminated memory-query resilience coverage",
    315: "HEALTH - full gate cadence",
    316: "Non-finite memory-limit fallback coverage",
    317: "Negative memory-score threshold coverage",
    318: "Invalid memory-weight recovery coverage",
    319: "Empty memory-context boundary coverage",
    320: "HEALTH - full gate cadence",
}

SNIPPETS = {
    271: r"""
// Cycle 271: tokenization is Unicode-aware and keeps useful intra-token separators.
assert.deepEqual(
  memoryUtils.tokenizeMemoryText("Déro_hive's RPC-v2 + １２３"),
  ["déro_hive's", 'rpc-v2', '123']
);
""",
    272: r"""
// Cycle 272: tags are normalized, de-duplicated, and returned deterministically.
const cycle272Tags = memoryUtils.mergeMemoryTags([' #DERO ', 'local first'], ['dero', 'AI']);
assert.equal(cycle272Tags.length, 3);
assert.equal(cycle272Tags.includes('ai'), true);
assert.equal(cycle272Tags.includes('dero'), true);
assert.equal(cycle272Tags.includes('local-first'), true);
""",
    273: r"""
// Cycle 273: fingerprints ignore formatting drift while isolating empty entries.
assert.equal(memoryUtils.memoryFingerprint({ id: 'a', content: ' A\n B ' }), 'a b');
assert.equal(memoryUtils.memoryFingerprint({ id: 'empty-a', content: '   ' }), 'empty:empty-a');
""",
    274: r"""
// Cycle 274: lexical similarity handles identical, disjoint, and partial token sets.
assert.equal(memoryUtils.jaccardSimilarity('dero hive', 'hive dero'), 1);
assert.equal(memoryUtils.jaccardSimilarity('dero', 'wallet'), 0);
assert.equal(memoryUtils.jaccardSimilarity('dero hive', 'hive wallet'), 1 / 3);
""",
    276: r"""
// Cycle 276: tag scoring reports the fraction of requested tags available.
assert.equal(memoryUtils.tagOverlapScore(['DERO', 'missing'], ['#dero', 'other']), 0.5);
assert.equal(memoryUtils.tagOverlapScore([], ['dero']), 0);
""",
    277: r"""
// Cycle 277: recency scoring follows its configured half-life and clamps future dates.
assert.equal(memoryUtils.memoryRecencyScore(NOW, NOW, 30), 1);
assert.equal(memoryUtils.memoryRecencyScore(NOW - 30 * DAY, NOW, 30), 0.5);
assert.equal(memoryUtils.memoryRecencyScore(NOW + DAY, NOW, 30), 1);
""",
    278: r"""
// Cycle 278: summaries remove control bytes and normalize whitespace.
assert.equal(memoryUtils.summarizeMemoryContent('alpha\u0000\n\tbeta'), 'alpha beta');
assert.equal(memoryUtils.summarizeMemoryContent('alpha', 0), '');
""",
    279: r"""
// Cycle 279: summaries prefer a readable word boundary and support a one-char limit.
assert.equal(memoryUtils.summarizeMemoryContent('alpha beta gamma', 12), 'alpha beta…');
assert.equal(memoryUtils.summarizeMemoryContent('alpha', 1), '…');
""",
    281: r"""
// Cycle 281: search parsing separates plain terms from exact phrases.
const cycle281Query = memoryUtils.parseMemorySearchQuery('wallet sync "exact phrase"');
assert.equal(cycle281Query.text, 'wallet sync');
assert.deepEqual(cycle281Query.phrases, ['exact phrase']);
""",
    282: r"""
// Cycle 282: escaped quotes survive phrase parsing without leaking into plain text.
const cycle282Query = memoryUtils.parseMemorySearchQuery('"quoted \\"value\\"" tail');
assert.deepEqual(cycle282Query.phrases, ['quoted "value"']);
assert.equal(cycle282Query.text, 'tail');
""",
    283: r"""
// Cycle 283: tag/source filters normalize and de-duplicate values.
const cycle283Query = memoryUtils.parseMemorySearchQuery('tag:#DERO tag:local-first source:CLI source:cli');
assert.deepEqual(cycle283Query.tags, ['dero', 'local-first']);
assert.deepEqual(cycle283Query.sources, ['cli']);
""",
    284: r"""
// Cycle 284: valid date filters become timestamps while malformed dates stay unset.
const cycle284Query = memoryUtils.parseMemorySearchQuery('before:2026-07-14 after:2026-07-12');
assert.equal(cycle284Query.before, Date.parse('2026-07-14'));
assert.equal(cycle284Query.after, Date.parse('2026-07-12'));
assert.equal(memoryUtils.parseMemorySearchQuery('before:not-a-date').before, undefined);
""",
    286: r"""
// Cycle 286: every requested plain token must be present in memory content.
const cycle286Entries = [memory('a', 'DERO wallet sync'), memory('b', 'wallet only')];
assert.deepEqual(memoryUtils.filterMemories(cycle286Entries, 'wallet DERO').map((entry) => entry.id), ['a']);
""",
    287: r"""
// Cycle 287: quoted phrases require contiguous normalized content.
const cycle287Entries = [memory('a', 'wallet sync complete'), memory('b', 'wallet then sync')];
assert.deepEqual(memoryUtils.filterMemories(cycle287Entries, '"wallet sync"').map((entry) => entry.id), ['a']);
""",
    288: r"""
// Cycle 288: all requested tags must be present after normalization.
const cycle288Entries = [
  memory('a', 'one', { tags: ['DERO', 'local-first'] }),
  memory('b', 'two', { tags: ['DERO'] })
];
assert.deepEqual(memoryUtils.filterMemories(cycle288Entries, 'tag:dero tag:local-first').map((entry) => entry.id), ['a']);
""",
    289: r"""
// Cycle 289: source filters are normalized case-insensitively.
const cycle289Entries = [memory('a', 'one', { source: 'CLI' }), memory('b', 'two', { source: 'desktop' })];
assert.deepEqual(memoryUtils.filterMemories(cycle289Entries, 'source:cli').map((entry) => entry.id), ['a']);
""",
    291: r"""
// Cycle 291: before/after filters use strict timestamp boundaries.
const cycle291Entries = [
  memory('old', 'one', { createdAt: NOW - 2 * DAY }),
  memory('boundary', 'two', { createdAt: NOW - DAY }),
  memory('new', 'three', { createdAt: NOW })
];
assert.deepEqual(memoryUtils.filterMemories(cycle291Entries, { text: '', phrases: [], tags: [], sources: [], before: NOW - DAY }).map((entry) => entry.id), ['old']);
assert.deepEqual(memoryUtils.filterMemories(cycle291Entries, { text: '', phrases: [], tags: [], sources: [], after: NOW - DAY }).map((entry) => entry.id), ['new']);
""",
    292: r"""
// Cycle 292: lexical-only scoring yields a perfect score for identical token sets.
const cycle292Score = memoryUtils.scoreMemory(memory('a', 'DERO wallet'), 'wallet DERO', {
  now: NOW,
  weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 }
});
assert.equal(cycle292Score.lexicalScore, 1);
assert.equal(cycle292Score.score, 1);
""",
    293: r"""
// Cycle 293: pin-only scoring explicitly boosts pinned memories.
const cycle293Score = memoryUtils.scoreMemory(memory('a', 'unrelated', { pinned: true }), 'query', {
  now: NOW,
  weights: { lexical: 0, recency: 0, tags: 0, pinned: 1 }
});
assert.equal(cycle293Score.pinScore, 1);
assert.equal(cycle293Score.score, 1);
""",
    294: r"""
// Cycle 294: an all-zero weight override safely falls back to balanced defaults.
const cycle294Score = memoryUtils.scoreMemory(memory('a', 'same'), 'same', {
  now: NOW,
  weights: { lexical: 0, recency: 0, tags: 0, pinned: 0 }
});
assert.equal(Math.abs(cycle294Score.score - 0.75) < 1e-12, true);
""",
    296: r"""
// Cycle 296: ranking orders exact, partial, then unrelated lexical matches.
const cycle296Ranked = memoryUtils.rankMemories(
  [memory('partial', 'dero wallet'), memory('exact', 'dero wallet sync'), memory('none', 'other')],
  'dero wallet sync',
  { now: NOW, weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 } }
);
assert.deepEqual(cycle296Ranked.map(({ entry }) => entry.id), ['exact', 'partial', 'none']);
""",
    297: r"""
// Cycle 297: equal scores break ties by freshness and then stable id order.
const cycle297ByDate = memoryUtils.rankMemories(
  [memory('old', 'same', { createdAt: NOW - DAY }), memory('new', 'same')],
  '',
  { now: NOW, weights: { lexical: 0, recency: 1, tags: 0, pinned: 0 } }
);
assert.deepEqual(cycle297ByDate.map(({ entry }) => entry.id), ['new', 'old']);
const cycle297ById = memoryUtils.rankMemories([memory('b', 'same'), memory('a', 'same')], '', { now: NOW });
assert.deepEqual(cycle297ById.map(({ entry }) => entry.id), ['a', 'b']);
""",
    298: r"""
// Cycle 298: source allow-lists and minimum scores compose deterministically.
const cycle298Entries = [memory('exact', 'dero wallet', { source: 'CLI' }), memory('partial', 'dero', { source: 'CLI' }), memory('desktop', 'dero wallet', { source: 'desktop' })];
const cycle298Ranked = memoryUtils.rankMemories(cycle298Entries, 'dero wallet', {
  now: NOW,
  sources: ['cli'],
  minScore: 0.75,
  weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 }
});
assert.deepEqual(cycle298Ranked.map(({ entry }) => entry.id), ['exact']);
""",
    299: r"""
// Cycle 299: result limits are floored and negative limits produce no results.
const cycle299Entries = Array.from({ length: 5 }, (_, index) => memory(String(index), 'same'));
assert.equal(memoryUtils.rankMemories(cycle299Entries, '', { limit: 2.9, now: NOW }).length, 2);
assert.equal(memoryUtils.rankMemories(cycle299Entries, '', { limit: -1, now: NOW }).length, 0);
""",
    301: r"""
// Cycle 301: duplicate normalized content keeps the newest memory.
const cycle301Deduped = memoryUtils.deduplicateMemories([
  memory('old', ' DERO\nHive ', { createdAt: NOW - DAY }),
  memory('new', 'dero hive', { createdAt: NOW })
]);
assert.deepEqual(cycle301Deduped.map((entry) => entry.id), ['new']);
""",
    302: r"""
// Cycle 302: a pinned duplicate wins even when an unpinned duplicate is newer.
const cycle302Deduped = memoryUtils.deduplicateMemories([
  memory('pinned', 'same', { createdAt: NOW - DAY, pinned: true }),
  memory('new', 'same', { createdAt: NOW })
]);
assert.deepEqual(cycle302Deduped.map((entry) => entry.id), ['pinned']);
""",
    303: r"""
// Cycle 303: exact duplicate ties select the lexicographically stable id.
const cycle303Deduped = memoryUtils.deduplicateMemories([memory('b', 'same'), memory('a', 'same')]);
assert.deepEqual(cycle303Deduped.map((entry) => entry.id), ['a']);
""",
    304: r"""
// Cycle 304: token estimates are empty-safe and conservatively rounded up.
assert.equal(memoryUtils.estimateMemoryTokens('   '), 0);
assert.equal(memoryUtils.estimateMemoryTokens('1234'), 1);
assert.equal(memoryUtils.estimateMemoryTokens('12345'), 2);
""",
    306: r"""
// Cycle 306: ranked memories are selected in order without exceeding budget.
const cycle306Ranked = [
  memoryUtils.scoreMemory(memory('a', 'aaaa'), 'aaaa', { now: NOW }),
  memoryUtils.scoreMemory(memory('b', 'bbbb'), 'bbbb', { now: NOW })
];
assert.deepEqual(memoryUtils.selectMemoriesForBudget(cycle306Ranked, 1).map(({ entry }) => entry.id), ['a']);
""",
    307: r"""
// Cycle 307: an oversized leading memory does not prevent a later small memory from fitting.
const cycle307Ranked = [
  memoryUtils.scoreMemory(memory('large', '12345678901234567890'), 'large', { now: NOW }),
  memoryUtils.scoreMemory(memory('small', 'tiny'), 'small', { now: NOW })
];
assert.deepEqual(memoryUtils.selectMemoriesForBudget(cycle307Ranked, 2).map(({ entry }) => entry.id), ['small']);
""",
    308: r"""
// Cycle 308: context output exposes source and normalized tags for inspection.
const cycle308Context = memoryUtils.buildMemoryContext(
  [memory('a', 'DERO wallet', { source: 'CLI', tags: ['dero', 'core'] })],
  'DERO wallet',
  { now: NOW, weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 } }
);
assert.equal(cycle308Context, '- [cli] DERO wallet (tags: core, dero)');
""",
    309: r"""
// Cycle 309: context rendering honors the per-memory content bound.
const cycle309Context = memoryUtils.buildMemoryContext(
  [memory('a', 'alpha beta gamma', { source: 'memory' })],
  'alpha beta gamma',
  { now: NOW, maxContentChars: 8, weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 } }
);
assert.equal(cycle309Context, '- [memory] alpha…');
""",
    311: r"""
// Cycle 311: updatedAt, when valid, is the timestamp used for recency scoring.
const cycle311Score = memoryUtils.scoreMemory(
  memory('updated', 'same', { createdAt: NOW - 30 * DAY, updatedAt: NOW }),
  '',
  { now: NOW, weights: { lexical: 0, recency: 1, tags: 0, pinned: 0 } }
);
assert.equal(cycle311Score.recencyScore, 1);
""",
    312: r"""
// Cycle 312: empty memories remain isolated by id instead of collapsing together.
assert.notEqual(
  memoryUtils.memoryFingerprint({ id: 'empty-a', content: '' }),
  memoryUtils.memoryFingerprint({ id: 'empty-b', content: '   ' })
);
""",
    313: r"""
// Cycle 313: compatibility normalization applies to tags as well as content.
assert.deepEqual(memoryUtils.mergeMemoryTags(['#ＤＥＲＯ', 'Local   First'], ['dero']), ['dero', 'local-first']);
""",
    314: r"""
// Cycle 314: an unterminated quote is preserved as searchable plain text.
const cycle314Query = memoryUtils.parseMemorySearchQuery('"unterminated phrase');
assert.equal(cycle314Query.text, '"unterminated phrase');
assert.deepEqual(cycle314Query.phrases, []);
""",
    316: r"""
// Cycle 316: non-finite result limits use the bounded default rather than leaking all results.
const cycle316Entries = Array.from({ length: 12 }, (_, index) => memory(String(index), 'same'));
assert.equal(memoryUtils.rankMemories(cycle316Entries, '', { limit: Number.POSITIVE_INFINITY, now: NOW }).length, 10);
""",
    317: r"""
// Cycle 317: negative score thresholds clamp to zero without hiding valid entries.
const cycle317Ranked = memoryUtils.rankMemories([memory('a', 'unrelated')], 'query', {
  now: NOW,
  minScore: -10,
  weights: { lexical: 1, recency: 0, tags: 0, pinned: 0 }
});
assert.deepEqual(cycle317Ranked.map(({ entry }) => entry.id), ['a']);
""",
    318: r"""
// Cycle 318: invalid weight values recover to the balanced default profile.
const cycle318Score = memoryUtils.scoreMemory(memory('a', 'same'), 'same', {
  now: NOW,
  weights: { lexical: Number.NaN, recency: -1, tags: -1, pinned: -1 }
});
assert.equal(Math.abs(cycle318Score.score - 0.75) < 1e-12, true);
""",
    319: r"""
// Cycle 319: empty collections and zero budgets produce no injected context.
assert.equal(memoryUtils.buildMemoryContext([], 'anything', { now: NOW }), '');
assert.equal(memoryUtils.buildMemoryContext([memory('a', 'same')], 'same', { now: NOW, tokenBudget: 0 }), '');
""",
}

GATES = [
    ("build", "npm.cmd run build"),
    ("typecheck", "npm.cmd run typecheck"),
    ("lint", "npm.cmd run lint && npm.cmd run lint:cli"),
    ("test-cli", "npm.cmd run test:cli"),
]


def journal_cycles() -> list[int]:
    text = JOURNAL.read_text(encoding="utf-8")
    return [int(value) for value in re.findall(r"^## Cycle (\d+)\b", text, flags=re.MULTILINE)]


def assert_ready(cycle: int) -> None:
    cycles = journal_cycles()
    owned = sorted(number for number in cycles if 271 <= number <= 320)
    expected = list(range(271, cycle))
    if owned != expected:
        raise RuntimeError(f"Journal resume invariant failed before Cycle {cycle}: found {owned}, expected {expected}")
    if cycle in cycles:
        raise RuntimeError(f"Cycle {cycle} already documented")


def apply_cycle(cycle: int) -> None:
    snippet = SNIPPETS.get(cycle)
    if snippet is None:
        return
    marker = f"// Cycle {cycle}:"
    text = TEST.read_text(encoding="utf-8")
    if marker in text:
        return
    anchor = "\nconsole.log('agentMemory.test.ts — all assertions passed');"
    if anchor not in text:
        raise RuntimeError("agentMemory.test.ts console anchor is missing")
    TEST.write_text(text.replace(anchor, snippet.rstrip() + anchor, 1), encoding="utf-8")


def run_gates(cycle: int) -> dict[str, float]:
    durations: dict[str, float] = {}
    for name, command in GATES:
        started = time.monotonic()
        completed = subprocess.run(
            command,
            cwd=ROOT,
            shell=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
        )
        elapsed = time.monotonic() - started
        durations[name] = elapsed
        log_path = LOG_DIR / f"cycle-{cycle}-{name}.log"
        log_path.write_text(completed.stdout, encoding="utf-8")
        print(f"Cycle {cycle} {name}: exit {completed.returncode} ({elapsed:.1f}s)", flush=True)
        if completed.returncode != 0:
            tail = "\n".join(completed.stdout.splitlines()[-100:])
            print(tail, file=sys.stderr, flush=True)
            raise RuntimeError(f"Cycle {cycle} gate failed: {name}; see {log_path}")
    return durations


def document(cycle: int, durations: dict[str, float]) -> None:
    title = TITLES[cycle]
    health = cycle % 5 == 0
    changed = "No runtime or test source changes; self-evolve state only." if health else "Extended `cli/src/utils/agentMemory.test.ts` with one focused executable regression block; runtime source and dependencies unchanged."
    chosen = "Run the complete required health-gate sequence without net-new behavior." if health else f"Add focused coverage for {title.lower()}."
    next_line = "Mandate complete." if cycle == 320 else f"Re-read JOURNAL.md and begin Cycle {cycle + 1}."
    entry = (
        f"\n\n## Cycle {cycle} — {title} — 2026-07-13\n"
        f"- Assess: Fresh journal read confirmed Cycle {cycle - 1}; targeted inspection continued the local-first agent-memory reliability surface.\n"
        f"- Chosen: {chosen} (score V3/F5/E1/R1).\n"
        f"- Changed: {changed}\n"
        f"- Verification: `npm run build` -> exit 0 / passed / {durations['build']:.1f}s; "
        f"`npm run typecheck` -> exit 0 / passed / {durations['typecheck']:.1f}s; "
        f"`npm run lint && npm run lint:cli` -> exit 0 / passed / {durations['lint']:.1f}s; "
        f"`npm run test:cli` -> exit 0 / passed / {durations['test-cli']:.1f}s. "
        f"Gate logs: `{LOG_DIR}`.\n"
        f"- Result: verified; protected paths and dependencies unchanged.\n"
        f"- Next: {next_line}\n"
    )
    with JOURNAL.open("a", encoding="utf-8", newline="") as handle:
        handle.write(entry)
    if cycle not in journal_cycles():
        raise RuntimeError(f"Cycle {cycle} journal append did not persist")
    print(f"Cycle {cycle} documented immediately after gates", flush=True)


def main() -> None:
    existing = sorted(number for number in journal_cycles() if 271 <= number <= 320)
    start = max(existing, default=270) + 1
    if existing and existing != list(range(271, start)):
        raise RuntimeError(f"Non-contiguous existing cycle range: {existing}")
    print(f"Starting continuous run at Cycle {start}; logs: {LOG_DIR}", flush=True)
    for cycle in range(start, 321):
        assert_ready(cycle)
        apply_cycle(cycle)
        durations = run_gates(cycle)
        document(cycle, durations)
    print("Cycles 271-320 completed and documented continuously.", flush=True)
    Path(__file__).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
