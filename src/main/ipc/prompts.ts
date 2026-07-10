import { ipcMain } from 'electron';
import { IPC, type PromptTemplate } from '@shared/types';
import { getDb } from '../db/client';

// Prompt Library — reusable prompt templates inserted via the "#" composer trigger.
export function registerPromptHandlers(): void {
  ipcMain.handle(IPC.PROMPT_LIST, () => {
    const rows = getDb().prepare('SELECT * FROM prompts ORDER BY category, title').all() as Array<Record<string, unknown>>;
    return rows.map((r): PromptTemplate => ({
      id: r.id as string,
      title: r.title as string,
      content: r.content as string,
      category: (r.category as string) || undefined,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number
    }));
  });

  ipcMain.handle(IPC.PROMPT_SAVE, (_e, p: PromptTemplate) => {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO prompts (id, title, content, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        category = excluded.category,
        updated_at = excluded.updated_at
    `).run(p.id, p.title, p.content, p.category || null, p.createdAt || now, now);
    return { ok: true };
  });

  ipcMain.handle(IPC.PROMPT_DELETE, (_e, id: string) => {
    getDb().prepare('DELETE FROM prompts WHERE id = ?').run(id);
    return { ok: true };
  });
}
