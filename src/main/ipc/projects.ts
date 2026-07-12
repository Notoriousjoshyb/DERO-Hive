import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC, normalizeProjectConfig, type Project, type ProjectConfig } from '@shared/types';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC.PROJECT_LIST, () => {
    const rows = getDb().prepare('SELECT * FROM projects ORDER BY name').all() as Array<Record<string, unknown>>;
    return rows.map(rowToProject);
  });

  ipcMain.handle(IPC.PROJECT_SAVE, async (event, project: Project) => {
    const projectPath = validateProjectPath(project.path);
    const config = normalizeProjectConfig(project.config);
    const existing = getDb().prepare('SELECT config FROM projects WHERE id = ?').get(project.id) as { config?: string } | undefined;
    const currentConfig = parseStoredProjectConfig(existing?.config);
    if (needsKnowledgeWriteConsent(currentConfig, config)) {
      const knowledge = config.knowledge!;
      const options = {
        type: 'warning' as const,
        title: 'Allow automatic vault writes?',
        message: `Allow DERO Hive to write inside "${knowledge.folder}"?`,
        detail: [
          `Obsidian server: ${knowledge.serverId}`,
          `Allowed folder: ${knowledge.folder}`,
          '',
          'Hive may create, append, or patch notes in this folder for captures and scheduled syntheses.',
          'It will not delete or move notes, execute Obsidian commands, or write outside this folder.'
        ].join('\n'),
        buttons: ['Cancel', 'Allow scoped writes'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      };
      const parent = BrowserWindow.fromWebContents(event.sender);
      const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (result.response !== 1) throw new Error('Automatic vault writes were not approved');
    }
    const now = Date.now();
    const db = getDb();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, name, icon, color, path, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          icon = excluded.icon,
          color = excluded.color,
          path = excluded.path,
          config = excluded.config,
          updated_at = excluded.updated_at
      `).run(project.id, project.name, project.icon, project.color || null, projectPath, JSON.stringify(config), project.createdAt, now);
      if (revokesKnowledgeWriteConsent(currentConfig, config)) {
        db.prepare('UPDATE knowledge_automations SET enabled = 0 WHERE project_id = ?').run(project.id);
      }
    })();
    logger.info('project', `saved ${project.name} (id=${project.id})`);
    return rowToProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) as Record<string, unknown>);
  });

  ipcMain.handle(IPC.PROJECT_DELETE, (_e, id: string) => {
    const db = getDb();
    db.transaction(() => {
      // Orphan the project's conversations so the foreign key doesn't block deletion
      db.prepare('UPDATE conversations SET project_id = NULL WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    })();
    logger.info('project', `deleted ${id}`);
  });
}

export function needsKnowledgeWriteConsent(current: ProjectConfig, next: ProjectConfig): boolean {
  const before = current.knowledge;
  const after = next.knowledge;
  return after?.allowAutomationWrites === true && (
    before?.allowAutomationWrites !== true
    || before.serverId !== after.serverId
    || before.folder !== after.folder
  );
}

export function revokesKnowledgeWriteConsent(current: ProjectConfig, next: ProjectConfig): boolean {
  return current.knowledge?.allowAutomationWrites === true && next.knowledge?.allowAutomationWrites !== true;
}

export function validateProjectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Project path is required');
  const projectPath = resolve(value.trim());
  try {
    if (!statSync(projectPath).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`Project path is not an existing directory: ${projectPath}`);
  }
  return projectPath;
}

export function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    icon: row.icon as string,
    color: row.color as string | undefined,
    path: row.path as string,
    config: parseStoredProjectConfig(row.config),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  };
}

function parseStoredProjectConfig(value: unknown): ProjectConfig {
  if (typeof value !== 'string' || !value) return {};
  try { return normalizeProjectConfig(JSON.parse(value)); }
  catch (error) {
    logger.warn('project', `ignoring invalid stored config: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}
