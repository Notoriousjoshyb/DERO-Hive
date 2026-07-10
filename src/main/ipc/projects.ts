import { ipcMain } from 'electron';
import { IPC, type Project } from '@shared/types';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC.PROJECT_LIST, () => {
    const rows = getDb().prepare('SELECT * FROM projects ORDER BY name').all() as Array<Record<string, unknown>>;
    return rows.map(rowToProject);
  });

  ipcMain.handle(IPC.PROJECT_SAVE, (_e, project: Project) => {
    const projectPath = validateProjectPath(project.path);
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO projects (id, name, icon, color, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        icon = excluded.icon,
        color = excluded.color,
        path = excluded.path,
        updated_at = excluded.updated_at
    `).run(project.id, project.name, project.icon, project.color || null, projectPath, project.createdAt, now);
    logger.info('project', `saved ${project.name} (id=${project.id})`);
    return rowToProject(getDb().prepare('SELECT * FROM projects WHERE id = ?').get(project.id) as Record<string, unknown>);
  });

  ipcMain.handle(IPC.PROJECT_DELETE, (_e, id: string) => {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
    logger.info('project', `deleted ${id}`);
  });
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

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    icon: row.icon as string,
    color: row.color as string | undefined,
    path: row.path as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  };
}
