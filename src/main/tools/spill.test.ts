import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// paths.spill resolves off HIVE_DATA_DIR outside Electron, so it must be set
// before the module initializes. The root package is CJS (no top-level await),
// so the import happens inside main() — same shape as registry.trust.test.ts.
const root = mkdtempSync(join(tmpdir(), 'hive-spill-'));
process.env.HIVE_DATA_DIR = root;
process.env.HIVE_CLI = '1';

const CONV = 'conv-spill-1';

async function main(): Promise<void> {
  const { applySpill, saveSpill, spillPreview, pruneSpill, DEFAULT_MAX_INLINE_BYTES } = await import('./spill');

  // ── under the cap: untouched ────────────────────────────────────────────
  const small = 'x'.repeat(100);
  const smallOut = applySpill(small, CONV, 'grep_files');
  assert.equal(smallOut.content, small, 'small results must pass through verbatim');
  assert.equal(smallOut.spilled, undefined);

  // exactly at the cap is still inline (the boundary is <=)
  const exact = 'y'.repeat(DEFAULT_MAX_INLINE_BYTES);
  assert.equal(applySpill(exact, CONV, 'grep_files').spilled, undefined);

  // ── over the cap: spilled ───────────────────────────────────────────────
  const big = 'HEAD_MARKER' + 'z'.repeat(DEFAULT_MAX_INLINE_BYTES * 2) + 'TAIL_MARKER';
  const out = applySpill(big, CONV, 'grep_files');

  assert.notEqual(out.spilled, undefined, 'oversized results must spill');
  assert.ok(out.content.length < big.length, 'preview must be shorter than the original');
  assert.ok(out.content.startsWith('[Output too large'), 'preview leads with the truncation notice');
  assert.ok(out.content.includes('HEAD_MARKER'), 'preview keeps the head');
  assert.ok(out.content.includes('TAIL_MARKER'), 'preview keeps the tail');
  assert.ok(out.content.includes('characters elided'), 'preview states how much was dropped');
  assert.ok(out.content.includes(out.spilled!.path), 'preview names the file it wrote');
  assert.ok(/grep_files/i.test(out.content), 'preview tells the model how to retrieve more');

  // the file on disk holds the ORIGINAL in full — the whole point of spilling
  assert.equal(readFileSync(out.spilled!.path, 'utf-8'), big, 'spill file must hold the complete output');
  assert.equal(out.spilled!.bytes, Buffer.byteLength(big, 'utf-8'));

  // ── multibyte accounting ────────────────────────────────────────────────
  // The cap is bytes, not characters: 10k 3-byte chars is 30 KB and must spill
  // even though String.length is under the cap.
  const multibyte = '☃'.repeat(10_000);
  assert.ok(multibyte.length < DEFAULT_MAX_INLINE_BYTES, 'precondition: under the cap by character count');
  assert.notEqual(applySpill(multibyte, CONV, 'read_file').spilled, undefined, 'byte length is what gates spilling');

  // ── filenames ───────────────────────────────────────────────────────────
  // Two spills of the same tool never collide.
  const a = saveSpill('a', CONV, 'grep_files');
  const b = saveSpill('b', CONV, 'grep_files');
  assert.notEqual(a!.path, b!.path, 'random prefix keeps concurrent spills apart');
  assert.equal(readFileSync(a!.path, 'utf-8'), 'a');
  assert.equal(readFileSync(b!.path, 'utf-8'), 'b');

  // Different conversations land in different buckets, so pruning one
  // conversation cannot take another's spills with it.
  const other = saveSpill('data', 'conv-spill-2', 'grep_files');
  assert.notEqual(dirname(other!.path), dirname(a!.path), 'each conversation gets its own bucket');

  // A hostile tool name must not escape the bucket. The separators are replaced
  // rather than the dots stripped, so "../../../etc/passwd" collapses to one
  // safe segment — what matters is that no traversal actually happened.
  const evil = saveSpill('data', CONV, '../../../etc/passwd');
  assert.notEqual(evil, null);
  assert.equal(dirname(evil!.path), dirname(a!.path), 'a traversing name still lands in its own bucket');
  assert.ok(!basename(evil!.path).includes('/') && !basename(evil!.path).includes('\\'),
    'the filename is a single path segment');
  assert.equal(readFileSync(evil!.path, 'utf-8'), 'data');

  // ── pruning ─────────────────────────────────────────────────────────────
  // Deleting a conversation drops its spills and nothing else.
  pruneSpill(CONV);
  assert.equal(existsSync(a!.path), false, 'the deleted conversation loses its spill files');
  assert.equal(existsSync(other!.path), true, 'another conversation keeps its own');
  // Pruning a conversation that never spilled is a no-op, not an error.
  pruneSpill('conv-that-never-existed');
  pruneSpill(CONV);

  // ── preview without a real file ─────────────────────────────────────────
  const previewOnly = spillPreview('short', { path: join(root, 'nope.txt'), bytes: 5 });
  assert.ok(previewOnly.includes('nope.txt'), 'preview renders whatever locator it is given');

  console.log('spill.test.ts — all assertions passed');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => rmSync(root, { recursive: true, force: true }));
