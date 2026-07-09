import { ipcMain } from 'electron';
import { IPC, type Skill } from '@shared/types';
import { getDb } from '../db/client';
import { BUILTIN_SKILLS } from '@shared/defaults';
import { loadBundledSkills } from '../skills/loader';
import { logger } from '../utils/logger';

export function registerSkillHandlers(): void {
  // Seed built-in skills on first run
  const count = (getDb().prepare('SELECT COUNT(*) AS c FROM skills WHERE builtin = 1').get() as { c: number }).c;
  if (count === 0) {
    const insert = getDb().prepare(`
      INSERT INTO skills (id, name, description, slash_command, prompt, enabled, builtin, category, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const s of BUILTIN_SKILLS) {
      insert.run(s.id, s.name, s.description, s.slashCommand, s.prompt, s.enabled ? 1 : 0, s.category || null, Date.now());
    }
    logger.info('skills', `seeded ${BUILTIN_SKILLS.length} built-in skills`);
  }

  // Seed bundled skills (DERO ecosystem skills shipped in resources/skills/)
  const bundledCount = (getDb().prepare("SELECT COUNT(*) AS c FROM skills WHERE category = 'DERO'").get() as { c: number }).c;
  if (bundledCount === 0) {
    const bundled = loadBundledSkills();
    if (bundled.length > 0) {
      const insert = getDb().prepare(`
        INSERT INTO skills (id, name, description, slash_command, prompt, enabled, builtin, category, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `);
      for (const s of bundled) {
        insert.run(s.id, s.name, s.description, s.slashCommand, s.prompt, s.category, Date.now());
      }
      logger.info('skills', `seeded ${bundled.length} bundled DERO skills`);
    }
  }

  ipcMain.handle(IPC.SKILL_LIST, () => {
    const rows = getDb().prepare('SELECT * FROM skills ORDER BY builtin DESC, name').all() as Array<{
      id: string; name: string; description: string; slash_command: string;
      prompt: string; enabled: number; builtin: number; category: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      slashCommand: r.slash_command, prompt: r.prompt,
      enabled: r.enabled === 1, builtin: r.builtin === 1,
      category: r.category || undefined
    } satisfies Skill));
  });

  ipcMain.handle(IPC.SKILL_SAVE, (_e, skill: Skill) => {
    getDb().prepare(`
      INSERT INTO skills (id, name, description, slash_command, prompt, enabled, builtin, category, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        slash_command = excluded.slash_command, prompt = excluded.prompt,
        enabled = excluded.enabled, category = excluded.category,
        updated_at = excluded.updated_at
    `).run(
      skill.id, skill.name, skill.description || '', skill.slashCommand,
      skill.prompt, skill.enabled ? 1 : 0, skill.builtin ? 1 : 0,
      skill.category || null, Date.now()
    );
    return skill;
  });

  ipcMain.handle(IPC.SKILL_DELETE, (_e, id: string) => {
    // Don't delete builtins, just disable
    const row = getDb().prepare('SELECT builtin FROM skills WHERE id = ?').get(id) as { builtin: number } | undefined;
    if (!row) return { ok: true };
    if (row.builtin === 1) {
      getDb().prepare('UPDATE skills SET enabled = 0 WHERE id = ?').run(id);
    } else {
      getDb().prepare('DELETE FROM skills WHERE id = ?').run(id);
    }
    return { ok: true };
  });
}