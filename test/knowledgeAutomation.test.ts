import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { KnowledgeAutomation } from '../src/shared/types';
import type { TestDb } from './helpers/sqlite';
import { createTestDbFromSchema } from './helpers/sqlite';

let db: TestDb;
const provider = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, closed: [] as string[] }));

vi.mock('../src/main/db/client', () => ({ getDb: () => db }));
vi.mock('../src/main/providers/registry', () => ({
  getAdapter: () => ({
    nativeToolScope: 'none',
    nativeExecutionModes: ['read-only'],
    async *stream(request: Record<string, unknown>) {
      provider.calls.push(request);
      yield { type: 'delta', content: 'Themes and next actions.' };
      yield { type: 'done' };
    }
  }),
  closeConversationSessions: async (id: string) => { provider.closed.push(id); }
}));

const { KnowledgeAutomationScheduler, isKnowledgeAutomationDue, knowledgeAutomationRunKey } =
  await import('../src/main/knowledge/automation');

function knowledge() {
  const writes: Array<{ path: string; content: string }> = [];
  const appends: Array<{ path: string; content: string }> = [];
  let outboxRetries = 0;
  return {
    writes,
    appends,
    get outboxRetries() { return outboxRetries; },
    retryOutbox: async () => { outboxRetries++; return { retried: 0, delivered: 0, failed: 0 }; },
    status: () => ({
      projectId: 'p', configured: true, connected: true, folder: 'Hive/Project', capabilities: ['list', 'read', 'search', 'write', 'append', 'patch', 'open'], missing: []
    }),
    list: async (_projectId: string, path: string) => ({
      path,
      entries: path === 'Inbox/Raw' ? [{ name: '2026-07-10-capture.md', directory: false }] : []
    }),
    readDocument: async (_projectId: string, path: string) => {
      const saved = writes.find((write) => write.path === path);
      if (saved) return {
        path,
        content: saved.content + appends.filter((append) => append.path === path).map((append) => append.content).join('')
      };
      if (path.startsWith('Inbox/Raw/')) return { path, content: 'A raw idea.', modifiedAt: Date.now() };
      throw new Error(`File not found: ${path}`);
    },
    write: async (input: { path: string; content: string }) => { writes.push(input); return { path: input.path }; },
    append: async (input: { path: string; content: string }) => { appends.push(input); return { path: input.path }; }
  };
}

const morning = (overrides: Partial<KnowledgeAutomation> = {}): KnowledgeAutomation => ({
  projectId: 'p', kind: 'morning-digest', enabled: true,
  localHour: 7, localMinute: 0, providerId: 'provider', model: 'model', ...overrides
});

beforeEach(() => {
  provider.calls.length = 0;
  provider.closed.length = 0;
  db = createTestDbFromSchema(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, config TEXT NOT NULL);
    CREATE TABLE providers (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
    CREATE TABLE knowledge_automations (
      project_id TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL,
      local_hour INTEGER NOT NULL, local_minute INTEGER NOT NULL, weekly_weekday INTEGER,
      provider_id TEXT NOT NULL, model TEXT NOT NULL, last_run_key TEXT, last_run_at INTEGER, last_error TEXT,
      PRIMARY KEY(project_id, kind)
    );
  `);
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('p', JSON.stringify({
    knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/Project', allowAutomationWrites: true }
  }));
  db.prepare('INSERT INTO providers VALUES (?, 1)').run('provider');
});

afterEach(() => db.close());

describe('fixed knowledge automation schedule', () => {
  test('computes local daily and ISO-week due windows without a cron parser', () => {
    expect(isKnowledgeAutomationDue(morning(), new Date(2026, 6, 10, 6, 59))).toBe(false);
    expect(isKnowledgeAutomationDue(morning(), new Date(2026, 6, 10, 7, 0))).toBe(true);
    expect(isKnowledgeAutomationDue(morning({ lastRunKey: '2026-07-10' }), new Date(2026, 6, 10, 9, 0))).toBe(false);

    const weekly = morning({ kind: 'weekly-synthesis', weeklyWeekday: 5, localHour: 8 });
    expect(isKnowledgeAutomationDue(weekly, new Date(2026, 6, 10, 7, 59))).toBe(false); // Friday
    expect(isKnowledgeAutomationDue(weekly, new Date(2026, 6, 12, 9, 0))).toBe(true); // Sunday catch-up
    expect(knowledgeAutomationRunKey('weekly-synthesis', new Date(2026, 0, 1))).toMatch(/^2026-W01$/);
  });

  test('catches up once after startup time and remains idempotent for the current day', async () => {
    const vault = knowledge();
    const scheduler = new KnowledgeAutomationScheduler(vault as never);
    scheduler.save({
      projectId: 'p', kind: 'morning-digest', enabled: true,
      localHour: 7, localMinute: 0, providerId: 'provider', model: 'model'
    });

    const now = new Date(2026, 6, 10, 9, 30);
    await scheduler.tick(now);
    await scheduler.tick(now);
    await expect(scheduler.runNow('p', 'morning-digest', now)).resolves.toEqual(expect.objectContaining({ status: 'skipped' }));

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].tools).toEqual([]);
    expect(vault.writes).toHaveLength(1);
    expect(vault.writes[0].path).toBe('Daily/2026-07-10.md');
    expect(vault.writes[0].content).toContain('[[Hive/Project/Inbox/Raw/2026-07-10-capture]]');
    expect(vault.appends).toEqual([]);
    expect(scheduler.list('p')[0]).toEqual(expect.objectContaining({ lastRunKey: '2026-07-10' }));
    expect(scheduler.list('p')[0]).not.toHaveProperty('error');
    expect(provider.closed).toHaveLength(1);

    db.prepare(`
      UPDATE knowledge_automations SET last_run_at = NULL, last_error = 'Run interrupted before completion'
      WHERE project_id = 'p' AND kind = 'morning-digest'
    `).run();
    await scheduler.tick(now);
    expect(provider.calls).toHaveLength(1);
    expect(scheduler.list('p')[0]).not.toHaveProperty('error');
    expect(scheduler.list('p')[0].lastRunAt).toEqual(expect.any(Number));
    expect(vault.outboxRetries).toBe(1);
  });

  test('does not claim or invoke a provider after automation consent is revoked', async () => {
    const vault = knowledge();
    const scheduler = new KnowledgeAutomationScheduler(vault as never);
    scheduler.save({
      projectId: 'p', kind: 'morning-digest', enabled: true,
      localHour: 7, localMinute: 0, providerId: 'provider', model: 'model'
    });
    db.prepare('UPDATE projects SET config = ? WHERE id = ?').run(JSON.stringify({
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/Project' }
    }), 'p');

    await scheduler.tick(new Date(2026, 6, 10, 9, 30));

    expect(provider.calls).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(scheduler.list('p')[0]).not.toHaveProperty('lastRunKey');
    expect(scheduler.list('p')[0]).toEqual(expect.objectContaining({
      error: 'Automated knowledge writes are disabled for this project'
    }));
  });

  test('builds the weekly synthesis from daily, decision, and question notes', async () => {
    const vault = knowledge();
    vault.list = async (_projectId: string, path: string) => ({
      path,
      entries: path === 'Daily'
        ? ['2026-07-08.md', '2026-07-09.md'].map((name) => ({ name, directory: false }))
        : []
    });
    vault.readDocument = async (_projectId: string, path: string) => {
      if (path.startsWith('Daily/') || path === 'Decisions.md' || path === 'Open Questions.md') {
        return { path, content: `Contents of ${path}` };
      }
      throw new Error(`File not found: ${path}`);
    };
    const scheduler = new KnowledgeAutomationScheduler(vault as never);
    scheduler.save({
      projectId: 'p', kind: 'weekly-synthesis', enabled: true,
      localHour: 8, localMinute: 0, weeklyWeekday: 5, providerId: 'provider', model: 'model'
    });

    const result = await scheduler.runNow('p', 'weekly-synthesis', new Date(2026, 6, 10, 9, 30));

    expect(result).toEqual(expect.objectContaining({ status: 'completed', path: 'Weekly/2026-W28.md' }));
    expect(vault.writes[0].content).toContain('[[Hive/Project/Decisions]]');
    expect(vault.writes[0].content).toContain('[[Hive/Project/Open Questions]]');
    expect(JSON.stringify(provider.calls[0].messages)).toContain('Contents of Daily/2026-07-08.md');
  });
});
