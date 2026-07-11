import { describe, expect, test } from 'vitest';
import { runMigrations } from '../src/main/db/client';
import { needsKnowledgeWriteConsent, rowToProject } from '../src/main/ipc/projects';
import { normalizeProjectConfig } from '../src/shared/types';
import { createTestDbFromSchema } from './helpers/sqlite';

describe('project config persistence', () => {
  test('migration preserves old projects and supplies an empty config', () => {
    const db = createTestDbFromSchema(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (10, 1);
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT, path TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO projects VALUES ('old', 'Old Project', 'x', NULL, '/old', 1, 2);
    `);
    try {
      runMigrations(db as unknown as Parameters<typeof runMigrations>[0]);
      expect(db.prepare('SELECT name, config FROM projects WHERE id = ?').get('old'))
        .toEqual({ name: 'Old Project', config: '{}' });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_outbox'").get())
        .toEqual({ name: 'knowledge_outbox' });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_automations'").get())
        .toEqual({ name: 'knowledge_automations' });
    } finally {
      db.close();
    }
  });

  test('normalizes and round-trips the typed config JSON', () => {
    const config = normalizeProjectConfig({
      kind: 'dero',
      mcpServerIds: [' dero ', 'obsidian', 'obsidian'],
      knowledge: {
        provider: 'obsidian', serverId: ' obsidian ', folder: 'Hive\\DERO', allowAutomationWrites: true
      }
    });
    const project = rowToProject({
      id: 'p', name: 'P', icon: 'x', path: '/p', config: JSON.stringify(config), created_at: 1, updated_at: 2
    });
    expect(project.config).toEqual({
      kind: 'dero',
      mcpServerIds: ['dero', 'obsidian'],
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/DERO', allowAutomationWrites: true }
    });
  });

  test('requires fresh native consent when an automatic vault scope is enabled or changed', () => {
    const allowed = normalizeProjectConfig({
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/DERO', allowAutomationWrites: true }
    });
    expect(needsKnowledgeWriteConsent({}, allowed)).toBe(true);
    expect(needsKnowledgeWriteConsent(allowed, allowed)).toBe(false);
    expect(needsKnowledgeWriteConsent(allowed, normalizeProjectConfig({
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/Other', allowAutomationWrites: true }
    }))).toBe(true);
    expect(needsKnowledgeWriteConsent(allowed, normalizeProjectConfig({
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/DERO', allowAutomationWrites: false }
    }))).toBe(false);
  });
});
