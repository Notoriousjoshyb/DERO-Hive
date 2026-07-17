import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force headless mode and an isolated data dir BEFORE importing db/store modules.
const tmp = mkdtempSync(join(tmpdir(), 'hive-checkpoints-'));
process.env.HIVE_DATA_DIR = tmp;
process.env.HIVE_WORKSPACE = join(tmp, 'workspace');
process.env.HIVE_RESOURCES = join(tmp, 'resources');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { initDb, getDb, closeDb } = require('../db/client') as typeof import('../db/client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('./store') as typeof import('./store');

let failures = 0;
async function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

const workDir = join(tmp, 'work');
const CONV = 'conv-test-1';
const blobDir = join(tmp, 'checkpoints');

function countRows(conversationId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM file_checkpoints WHERE conversation_id = ?').get(conversationId) as { n: number }).n;
}

async function main(): Promise<void> {
  await initDb();
  mkdirSync(workDir, { recursive: true });

  // Sanity: migration v15 must have created the table.
  const table = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'file_checkpoints'").get();
  assert.ok(table, 'file_checkpoints table should exist');

  await t('new-file capture → revert deletes the file', () => {
    const file = join(workDir, 'new-file.txt');
    const after = Buffer.from('brand new content', 'utf-8');
    const id = store.captureCheckpoint({ conversationId: CONV, toolCallId: 'tc-1', path: file, before: null, after });
    writeFileSync(file, after); // simulate the tool's write

    const res = store.revertCheckpoint(id);
    assert.equal(res.ok, true);
    assert.equal(res.restored, 'deleted');
    assert.equal(res.path, file);
    assert.ok(!existsSync(file), 'file should be deleted after revert');

    const row = getDb().prepare('SELECT before_hash, after_hash, reverted_at FROM file_checkpoints WHERE id = ?').get(id) as Record<string, unknown>;
    assert.equal(row.before_hash, null);
    assert.ok(row.after_hash, 'after_hash should be set');
    assert.ok(row.reverted_at, 'reverted_at should be set');
  });

  await t('existing-file edit → revert restores exact bytes (>50KB, no display cap)', () => {
    const file = join(workDir, 'big.txt');
    // 200KB — well past the 50KB renderer display cap.
    const before = Buffer.alloc(200_000, 'x');
    const after = Buffer.from('small replacement', 'utf-8');
    writeFileSync(file, before);
    const id = store.captureCheckpoint({ conversationId: CONV, path: file, before: readFileSync(file), after });
    writeFileSync(file, after); // simulate the tool's write

    const res = store.revertCheckpoint(id);
    assert.equal(res.ok, true);
    assert.equal(res.restored, 'content');
    const restored = readFileSync(file);
    assert.equal(restored.length, before.length, 'full 200KB must be restored, not the capped snapshot');
    assert.ok(restored.equals(before), 'restored bytes must match original exactly');
  });

  await t('revertAll processes newest first across two edits to the same file', () => {
    const file = join(workDir, 'chained.txt');
    const v1 = Buffer.from('version-1', 'utf-8');
    const v2 = Buffer.from('version-2', 'utf-8');
    const v3 = Buffer.from('version-3', 'utf-8');
    writeFileSync(file, v1);
    store.captureCheckpoint({ conversationId: CONV, path: file, before: v1, after: v2 });
    writeFileSync(file, v2);
    store.captureCheckpoint({ conversationId: CONV, path: file, before: v2, after: v3 });
    writeFileSync(file, v3);

    const res = store.revertAllCheckpoints(CONV, 0);
    assert.equal(res.failed.length, 0);
    assert.equal(res.reverted, 2);
    // Newest-first means the OLDEST before content (v1) ends up on disk.
    assert.equal(readFileSync(file, 'utf-8'), 'version-1');
  });

  await t('already-reverted checkpoint is a no-op', () => {
    const file = join(workDir, 'idempotent.txt');
    const before = Buffer.from('original', 'utf-8');
    writeFileSync(file, before);
    const id = store.captureCheckpoint({ conversationId: CONV, path: file, before, after: Buffer.from('changed', 'utf-8') });
    writeFileSync(file, 'changed', 'utf-8');

    const first = store.revertCheckpoint(id);
    assert.equal(first.ok, true);
    const revertedAt1 = (getDb().prepare('SELECT reverted_at FROM file_checkpoints WHERE id = ?').get(id) as { reverted_at: number }).reverted_at;

    // Diverge the file again — a second revert must NOT rewrite it.
    writeFileSync(file, 'diverged', 'utf-8');
    const second = store.revertCheckpoint(id);
    assert.equal(second.ok, true);
    assert.equal(readFileSync(file, 'utf-8'), 'diverged', 'second revert must not touch disk');
    const revertedAt2 = (getDb().prepare('SELECT reverted_at FROM file_checkpoints WHERE id = ?').get(id) as { reverted_at: number }).reverted_at;
    assert.equal(revertedAt2, revertedAt1, 'reverted_at must not be bumped');
  });

  await t('revertAll skips already-reverted rows and reports failures', () => {
    const conv = 'conv-test-2';
    const file = join(workDir, 'partial.txt');
    const before = Buffer.from('p0', 'utf-8');
    writeFileSync(file, before);
    const id = store.captureCheckpoint({ conversationId: conv, path: file, before, after: Buffer.from('p1', 'utf-8') });
    store.revertCheckpoint(id); // already reverted before revertAll runs

    const res = store.revertAllCheckpoints(conv, 0);
    assert.equal(res.reverted, 0, 'already-reverted row should be skipped');
    assert.equal(res.failed.length, 0);
  });

  await t('prune removes rows and unreferenced blobs, keeps shared ones', () => {
    const convA = 'conv-prune-a';
    const convB = 'conv-prune-b';
    const fileA = join(workDir, 'prune-a.txt');
    const fileB = join(workDir, 'prune-b.txt');
    const sharedContent = Buffer.from('shared-before', 'utf-8');
    const uniqueAfter = Buffer.from('unique-after-a', 'utf-8');

    const idA = store.captureCheckpoint({ conversationId: convA, path: fileA, before: sharedContent, after: uniqueAfter });
    const idB = store.captureCheckpoint({ conversationId: convB, path: fileB, before: sharedContent, after: Buffer.from('other', 'utf-8') });

    const rowA = getDb().prepare('SELECT before_hash, after_hash FROM file_checkpoints WHERE id = ?').get(idA) as { before_hash: string; after_hash: string };
    const sharedHash = rowA.before_hash;
    const uniqueHash = rowA.after_hash;
    assert.ok(existsSync(join(blobDir, sharedHash)));
    assert.ok(existsSync(join(blobDir, uniqueHash)));

    store.pruneConversation(convA);
    assert.equal(countRows(convA), 0, 'conv A rows should be deleted');
    assert.equal(countRows(convB), 1, 'conv B rows should remain');
    assert.ok(!existsSync(join(blobDir, uniqueHash)), 'unreferenced blob should be removed');
    assert.ok(existsSync(join(blobDir, sharedHash)), 'blob still referenced by conv B must survive');

    // B's rows must still be revertable after pruning A.
    writeFileSync(fileB, 'clobbered', 'utf-8');
    const res = store.revertCheckpoint(idB);
    assert.equal(res.ok, true);
    assert.equal(readFileSync(fileB, 'utf-8'), 'shared-before');
  });

  await t('capture without conversationId/toolCallId stores NULLs (defensive)', () => {
    const file = join(workDir, 'no-ctx.txt');
    const id = store.captureCheckpoint({ path: file, before: null, after: Buffer.from('x', 'utf-8') });
    const row = getDb().prepare('SELECT conversation_id, tool_call_id FROM file_checkpoints WHERE id = ?').get(id) as Record<string, unknown>;
    assert.equal(row.conversation_id, null);
    assert.equal(row.tool_call_id, null);
  });

  closeDb();
  rmSync(tmp, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('checkpoints.test.ts — all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
