import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { constants, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type Skill, type SkillImportPickResult, type SkillImportResult } from '@shared/types';
import { getDb } from '../db/client';
import { BUILTIN_SKILLS } from '@shared/defaults';
import { inspectSkillDirectory, loadBundledSkills, loadUserSkills, userSkillsDir } from '../skills/loader';
import { logger } from '../utils/logger';

/**
 * Sync file-based skills (bundled resources/skills + drop-in userData/skills,
 * both following the Agent Skills folder/SKILL.md standard) into the DB.
 * Idempotent: upserts by id, preserving the user's `enabled` choice, and
 * removes rows whose source folder has disappeared from disk.
 */
function syncFileSkills(): void {
  const db = getDb();
  const fileSkills = [...loadBundledSkills(), ...loadUserSkills()];

  const upsert = db.prepare(`
    INSERT INTO skills (id, name, description, slash_command, prompt, enabled, builtin, category, source_dir, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, description = excluded.description,
      slash_command = excluded.slash_command, prompt = excluded.prompt,
      builtin = excluded.builtin, category = excluded.category,
      source_dir = excluded.source_dir, updated_at = excluded.updated_at
  `);
  for (const s of fileSkills) {
    upsert.run(s.id, s.name, s.description, s.slashCommand, s.prompt, s.builtin ? 1 : 0, s.category, s.sourceDir, Date.now());
  }

  // A file-synced skill whose folder vanished is gone; one whose folder still
  // exists but failed validation is kept as-is (only a warning was logged).
  const rows = db.prepare('SELECT id, source_dir FROM skills WHERE source_dir IS NOT NULL').all() as Array<{ id: string; source_dir: string }>;
  const liveIds = new Set(fileSkills.map((s) => s.id));
  let removed = 0;
  for (const row of rows) {
    if (!liveIds.has(row.id) && !existsSync(row.source_dir)) {
      db.prepare('DELETE FROM skills WHERE id = ?').run(row.id);
      removed++;
    }
  }

  logger.info('skills', `synced ${fileSkills.length} file-based skills${removed ? `, removed ${removed} stale` : ''}`);
}

function listSkills(): Skill[] {
  const rows = getDb().prepare('SELECT * FROM skills ORDER BY builtin DESC, name').all() as Array<{
    id: string; name: string; description: string; slash_command: string;
    prompt: string; enabled: number; builtin: number; category: string | null;
    source_dir: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id, name: r.name, description: r.description,
    slashCommand: r.slash_command, prompt: r.prompt,
    enabled: r.enabled === 1, builtin: r.builtin === 1,
    category: r.category || undefined,
    sourceDir: r.source_dir || undefined
  } satisfies Skill));
}

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

  // Sync bundled + drop-in skill folders on every startup
  syncFileSkills();

  ipcMain.handle(IPC.SKILL_LIST, () => listSkills());

  ipcMain.handle(IPC.SKILL_RESCAN, () => {
    syncFileSkills();
    return listSkills();
  });

  ipcMain.handle(IPC.SKILL_OPEN_DIR, async () => {
    const error = await shell.openPath(userSkillsDir());
    return { ok: !error, error: error || undefined };
  });

  ipcMain.handle(IPC.SKILL_IMPORT_PICK, async (event): Promise<SkillImportPickResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select a skill folder',
      buttonLabel: 'Preview skill',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };

    const inspection = inspectSkillDirectory(result.filePaths[0]);
    return inspection.ok
      ? { ok: true, preview: inspection.preview }
      : { ok: false, error: inspection.error };
  });

  ipcMain.handle(IPC.SKILL_IMPORT, (_event, sourceDir: string): SkillImportResult => {
    if (typeof sourceDir !== 'string') return { ok: false, error: 'Invalid skill folder.' };

    // Revalidate at the trust boundary; the renderer-provided preview is not authoritative.
    const inspection = inspectSkillDirectory(sourceDir);
    if (!inspection.ok) return inspection;

    const destination = join(userSkillsDir(), inspection.preview.name);
    if (existsSync(destination)) {
      return { ok: false, error: `/${inspection.preview.name} is already installed.` };
    }

    let created = false;
    try {
      mkdirSync(destination);
      created = true;
      copyFileSync(inspection.skillPath, join(destination, 'SKILL.md'), constants.COPYFILE_EXCL);
    } catch (error) {
      if (created) rmSync(destination, { recursive: true, force: true });
      return { ok: false, error: error instanceof Error ? error.message : 'Skill import failed.' };
    }

    syncFileSkills();
    const skill = listSkills().find((item) => item.id === `user-${inspection.preview.name}`);
    return skill ? { ok: true, skill } : { ok: false, error: 'Skill copied but could not be loaded.' };
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
