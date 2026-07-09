import { ipcMain } from 'electron';
import { IPC, type Artifact } from '@shared/types';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client';

export function registerArtifactHandlers(): void {
  ipcMain.handle(IPC.ARTIFACT_SAVE, (_e, a: { conversationId: string; messageId: string; type: string; content: string; language?: string; title?: string }) => {
    const id = randomUUID();
    getDb().prepare(`
      INSERT INTO artifacts (id, conversation_id, message_id, type, language, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, a.conversationId, a.messageId, a.type, a.language || null, a.title || null, a.content, Date.now());
    return { id };
  });

  ipcMain.handle(IPC.ARTIFACT_LIST, (_e, conversationId?: string) => {
    const rows = (conversationId
      ? getDb().prepare('SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at DESC').all(conversationId)
      : getDb().prepare('SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 200').all()) as Array<{
      id: string; conversation_id: string; message_id: string; type: string;
      language: string | null; title: string | null; content: string; created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id, conversationId: r.conversation_id, messageId: r.message_id,
      type: r.type as Artifact['type'], language: r.language || undefined, title: r.title || undefined,
      content: r.content, createdAt: r.created_at
    } satisfies Artifact));
  });

  ipcMain.handle(IPC.ARTIFACT_DELETE, (_e, id: string) => {
    getDb().prepare('DELETE FROM artifacts WHERE id = ?').run(id);
    return { ok: true };
  });
}