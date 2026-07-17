import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type PermissionRule } from '@shared/types';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';

// Permission rules CRUD over the shared `permissions` table. The row shape and
// semantics intentionally mirror ToolRegistry.listRules/saveRule/deleteRule in
// src/main/tools/registry.ts so rules written here behave identically to rules
// written by the CLI (which drives the registry directly):
//   - tool_name matches exactly, or '*' matches every tool;
//   - pattern matches against JSON-stringified args — '/re/' runs as a regex,
//     anything else is a substring test;
//   - action: deny is absolute; a matching ask beats a matching allow;
//   - scope 'project' only applies when project_path matches the tool context
//     cwd (path-normalized); 'global'/absent applies everywhere.
export function registerPermissionHandlers(): void {
  ipcMain.handle(IPC.PERMISSION_RULE_LIST, () => {
    const rows = getDb().prepare('SELECT * FROM permissions ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map(rowToPermissionRule);
  });

  ipcMain.handle(IPC.PERMISSION_RULE_ADD, (_e, rule: Partial<PermissionRule>) => {
    const validated = validatePermissionRule(rule);
    getDb().prepare(`
      INSERT INTO permissions (id, tool_name, pattern, action, scope, project_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tool_name = excluded.tool_name,
        pattern = excluded.pattern,
        action = excluded.action,
        scope = excluded.scope,
        project_path = excluded.project_path
    `).run(validated.id, validated.toolName, validated.pattern || null, validated.action, validated.scope || null, validated.projectPath || null, Date.now());
    logger.info('permissions', `rule saved: ${validated.toolName} → ${validated.action} (${validated.scope || 'global'})`);
    return validated;
  });

  ipcMain.handle(IPC.PERMISSION_RULE_REMOVE, (_e, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Rule id is required');
    getDb().prepare('DELETE FROM permissions WHERE id = ?').run(id);
    logger.info('permissions', `rule removed: ${id}`);
    return { ok: true };
  });
}

function rowToPermissionRule(row: Record<string, unknown>): PermissionRule {
  return {
    id: row.id as string,
    toolName: row.tool_name as string,
    pattern: (row.pattern as string) || undefined,
    action: row.action as PermissionRule['action'],
    scope: (row.scope as PermissionRule['scope']) || undefined,
    projectPath: (row.project_path as string) || undefined
  };
}

function validatePermissionRule(rule: Partial<PermissionRule>): PermissionRule {
  if (!rule || typeof rule !== 'object') throw new Error('Permission rule must be an object');
  if (typeof rule.toolName !== 'string' || !rule.toolName.trim()) throw new Error('Rule tool name is required');
  if (rule.action !== 'allow' && rule.action !== 'deny' && rule.action !== 'ask') {
    throw new Error('Rule action must be allow, deny, or ask');
  }
  const scope = rule.scope ?? 'global';
  if (scope !== 'global' && scope !== 'project') throw new Error('Rule scope must be global or project');
  if (rule.pattern !== undefined) {
    if (typeof rule.pattern !== 'string' || !rule.pattern) throw new Error('Rule pattern must be a non-empty string');
    if (rule.pattern.startsWith('/') && rule.pattern.endsWith('/') && rule.pattern.length > 1) {
      try {
        new RegExp(rule.pattern.slice(1, -1));
      } catch {
        throw new Error('Rule pattern is not a valid regular expression');
      }
    }
  }
  const projectPath = typeof rule.projectPath === 'string' && rule.projectPath.trim() ? rule.projectPath.trim() : undefined;
  if (scope === 'project' && !projectPath) throw new Error('Project-scoped rules require a project path');
  return {
    id: typeof rule.id === 'string' && rule.id ? rule.id : randomUUID(),
    toolName: rule.toolName.trim(),
    pattern: rule.pattern,
    action: rule.action,
    scope,
    projectPath
  };
}
