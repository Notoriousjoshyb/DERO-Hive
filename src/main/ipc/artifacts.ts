import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import { IPC, type Artifact } from '@shared/types';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/client';

const EXPORT_EXT: Record<string, string> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mmd',
  react: 'jsx',
  markdown: 'md',
  code: 'txt'
};

function sanitizeFilename(s: string): string {
  return s.replace(/[<>:"/|?*]/g, '-').trim().slice(0, 80) || 'artifact';
}

export function registerArtifactHandlers(): void {
  // One-time cleanup: earlier builds re-inserted the same artifact every time a
  // conversation was opened. Keep the oldest row per (message, type, content).
  try {
    getDb().prepare(`
      DELETE FROM artifacts WHERE id NOT IN (
        SELECT id FROM artifacts a
        WHERE a.created_at = (
          SELECT MIN(b.created_at) FROM artifacts b
          WHERE b.message_id = a.message_id AND b.type = a.type AND b.content = a.content
        )
        GROUP BY a.message_id, a.type, a.content
      )
    `).run();
  } catch { /* best-effort */ }

  ipcMain.handle(IPC.ARTIFACT_SAVE, (_e, a: { conversationId: string; messageId: string; type: string; content: string; language?: string; title?: string }) => {
    // Idempotent: re-rendering a message re-extracts its artifacts, so an
    // identical artifact for the same message returns the existing row.
    const existing = getDb().prepare(
      'SELECT id FROM artifacts WHERE message_id = ? AND type = ? AND content = ?'
    ).get(a.messageId, a.type, a.content) as { id: string } | undefined;
    if (existing) return { id: existing.id };

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

  // Manual edit in the Vision panel: store as a NEW version row (immutable
  // history) tied to the same conversation/type/title so it groups with the
  // artifact it revises. message_id marks it as a manual edit.
  ipcMain.handle(IPC.ARTIFACT_UPDATE, (_e, a: { sourceId: string; content: string }) => {
    const src = getDb().prepare('SELECT * FROM artifacts WHERE id = ?').get(a.sourceId) as {
      conversation_id: string; type: string; language: string | null; title: string | null;
    } | undefined;
    if (!src) return { ok: false, error: 'Artifact not found' };
    const id = randomUUID();
    getDb().prepare(`
      INSERT INTO artifacts (id, conversation_id, message_id, type, language, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, src.conversation_id, `manual:${id}`, src.type, src.language, src.title, a.content, Date.now());
    return { ok: true, id };
  });

  // Download: save-as dialog with a sensible default extension.
  ipcMain.handle(IPC.VISION_EXPORT, async (_e, a: { title?: string; type: string; language?: string; content: string }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const ext = a.type === 'react' && a.language === 'tsx' ? 'tsx'
      : a.type === 'code' && a.language ? a.language
      : EXPORT_EXT[a.type] || 'txt';
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `${sanitizeFilename(a.title || `vision-${a.type}`)}.${ext}`
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    writeFileSync(r.filePath, a.content, 'utf8');
    return { ok: true, path: r.filePath };
  });

  // "Share": write the rendered document to a temp file and open it in the
  // default browser so it can be viewed/used outside the app.
  ipcMain.handle(IPC.VISION_OPEN_EXTERNAL, async (_e, a: { html: string; id: string }) => {
    const file = join(app.getPath('temp'), `hive-vision-${a.id.replace(/[^\w-]/g, '')}.html`);
    writeFileSync(file, a.html, 'utf8');
    await shell.openPath(file);
    return { ok: true, path: file };
  });
}
