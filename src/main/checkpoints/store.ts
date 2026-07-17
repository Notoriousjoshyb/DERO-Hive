import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { paths } from '../utils/paths';

// File-edit checkpoints (Phase 1E). Before/after file bytes are stored as
// content-addressed blobs (sha256 hex filename) under userData/checkpoints,
// with metadata rows in the file_checkpoints table. Blobs are shared across
// rows — identical content is written once and only removed when no row
// references it anymore.
const SCOPE = 'checkpoints';

function blobDir(): string {
  const dir = join(paths.userData, 'checkpoints');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function storeBlob(buf: Buffer): string {
  const hash = createHash('sha256').update(buf).digest('hex');
  const file = join(blobDir(), hash);
  // Content-addressed: an existing file already holds these exact bytes.
  if (!existsSync(file)) writeFileSync(file, buf);
  return hash;
}

export function readBlob(hash: string): Buffer {
  return readFileSync(join(blobDir(), hash));
}

interface CheckpointRow {
  id: string;
  conversation_id: string | null;
  tool_call_id: string | null;
  path: string;
  before_hash: string | null;
  after_hash: string | null;
  size_bytes: number | null;
  created_at: number;
  reverted_at: number | null;
}

export interface CaptureCheckpointInput {
  conversationId?: string;
  toolCallId?: string;
  path: string;
  before: Buffer | null;
  after: Buffer;
}

// Snapshot a file mutation. `before` is null when the file did not exist.
// Returns the checkpoint id. Blob writes happen before the row insert; if a
// blob write throws, no row is created and the caller decides how to proceed
// (tool executors log + continue).
export function captureCheckpoint(input: CaptureCheckpointInput): string {
  const beforeHash = input.before ? storeBlob(input.before) : null;
  const afterHash = storeBlob(input.after);
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO file_checkpoints (id, conversation_id, tool_call_id, path, before_hash, after_hash, size_bytes, created_at, reverted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(id, input.conversationId ?? null, input.toolCallId ?? null, input.path, beforeHash, afterHash, input.after.length, Date.now());
  return id;
}

export interface RevertResult {
  ok: boolean;
  path: string;
  restored: 'content' | 'deleted';
}

// Roll a single checkpoint back. Idempotent: an already-reverted row returns
// ok without touching disk again.
export function revertCheckpoint(id: string): RevertResult {
  const row = getDb().prepare('SELECT * FROM file_checkpoints WHERE id = ?').get(id) as CheckpointRow | undefined;
  if (!row) throw new Error(`checkpoint not found: ${id}`);
  const restored: RevertResult['restored'] = row.before_hash ? 'content' : 'deleted';
  if (row.reverted_at) return { ok: true, path: row.path, restored };

  if (row.before_hash) {
    const bytes = readBlob(row.before_hash);
    mkdirSync(dirname(row.path), { recursive: true });
    writeFileSync(row.path, bytes);
  } else {
    rmSync(row.path, { force: true });
  }
  getDb().prepare('UPDATE file_checkpoints SET reverted_at = ? WHERE id = ?').run(Date.now(), id);
  logger.info(SCOPE, `reverted ${row.path} (${restored})`);
  return { ok: true, path: row.path, restored };
}

export interface RevertAllResult {
  reverted: number;
  failed: Array<{ id: string; error: string }>;
}

// Roll back every checkpoint of a conversation since `since` (epoch ms,
// default 0 = all). Newest first so each older `before` snapshot overwrites
// the newer one and the oldest state ends up on disk. Individual failures are
// collected, not thrown, so one bad row doesn't block the rest.
export function revertAllCheckpoints(conversationId: string, since = 0): RevertAllResult {
  const rows = getDb().prepare(`
    SELECT id FROM file_checkpoints
    WHERE conversation_id = ? AND created_at >= ? AND reverted_at IS NULL
    ORDER BY created_at DESC, rowid DESC
  `).all(conversationId, since) as Array<{ id: string }>;

  const result: RevertAllResult = { reverted: 0, failed: [] };
  for (const { id } of rows) {
    try {
      revertCheckpoint(id);
      result.reverted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(SCOPE, `revert failed for checkpoint ${id}: ${message}`);
      result.failed.push({ id, error: message });
    }
  }
  return result;
}

// Drop all checkpoint rows of a conversation and remove blobs no longer
// referenced by any remaining row. Row deletion runs in a transaction; blob
// GC follows after so a crash mid-prune leaves at worst orphaned blobs, never
// dangling hash references.
export function pruneConversation(conversationId: string): void {
  const db = getDb();
  const orphans = db.transaction(() => {
    const hashes = db.prepare(
      'SELECT before_hash AS h FROM file_checkpoints WHERE conversation_id = ? AND before_hash IS NOT NULL UNION SELECT after_hash AS h FROM file_checkpoints WHERE conversation_id = ? AND after_hash IS NOT NULL'
    ).all(conversationId, conversationId) as Array<{ h: string }>;
    db.prepare('DELETE FROM file_checkpoints WHERE conversation_id = ?').run(conversationId);
    const stillReferenced = new Set<string>();
    for (const ref of db.prepare(
      'SELECT before_hash AS h FROM file_checkpoints WHERE before_hash IS NOT NULL UNION SELECT after_hash AS h FROM file_checkpoints WHERE after_hash IS NOT NULL'
    ).all() as Array<{ h: string }>) {
      stillReferenced.add(ref.h);
    }
    return hashes.map((r) => r.h).filter((h) => !stillReferenced.has(h));
  })();

  for (const hash of orphans) {
    try {
      rmSync(join(blobDir(), hash), { force: true });
    } catch (err) {
      logger.warn(SCOPE, `failed to remove blob ${hash}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  logger.info(SCOPE, `pruned conversation ${conversationId}: ${orphans.length} blob(s) removed`);
}
