import { ipcMain } from 'electron';
import { IPC, type FileCheckpoint } from '@shared/types';
import { getDb } from '../db/client';
import { revertAllCheckpoints, revertCheckpoint } from '../checkpoints/store';

// File-edit checkpoints (Phase 1E). Listing reads straight from the
// file_checkpoints table; revert delegates to the checkpoint store
// (content-addressed blobs under userData/checkpoints).
export function registerCheckpointHandlers(): void {
  ipcMain.handle(IPC.CHECKPOINT_LIST, (_e, conversationId: string) => {
    if (typeof conversationId !== 'string' || !conversationId) throw new Error('conversationId is required');
    const rows = getDb().prepare(
      'SELECT * FROM file_checkpoints WHERE conversation_id = ? ORDER BY created_at DESC'
    ).all(conversationId) as Array<Record<string, unknown>>;
    return rows.map(rowToFileCheckpoint);
  });

  ipcMain.handle(IPC.CHECKPOINT_REVERT, (_e, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('checkpoint id is required');
    try {
      return revertCheckpoint(id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.CHECKPOINT_REVERT_ALL, (_e, payload: { conversationId: string; since?: number }) => {
    if (!payload || typeof payload.conversationId !== 'string' || !payload.conversationId) {
      throw new Error('conversationId is required');
    }
    try {
      const { reverted, failed } = revertAllCheckpoints(payload.conversationId, payload.since);
      return { ok: failed.length === 0, reverted, failed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function rowToFileCheckpoint(row: Record<string, unknown>): FileCheckpoint {
  return {
    id: row.id as string,
    conversationId: (row.conversation_id as string) || '',
    toolCallId: (row.tool_call_id as string) || undefined,
    path: row.path as string,
    beforeHash: (row.before_hash as string) || undefined,
    afterHash: (row.after_hash as string) || undefined,
    sizeBytes: (row.size_bytes as number) ?? 0,
    createdAt: row.created_at as number,
    revertedAt: (row.reverted_at as number) ?? undefined
  };
}
