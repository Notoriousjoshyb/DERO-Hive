import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TestDb } from './helpers/sqlite';
import { createTestDbFromSchema } from './helpers/sqlite';

let db: TestDb;
vi.mock('../src/main/db/client', () => ({ getDb: () => db }));

const { KnowledgeService } = await import('../src/main/knowledge/service');

const ALL_TOOLS = ['vault_list', 'vault_read', 'search_simple', 'vault_write', 'vault_append', 'vault_patch', 'open_file'];

function manager(toolNames = ALL_TOOLS) {
  let failWrite = false;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    setFailWrite(value: boolean) { failWrite = value; },
    getInstance: () => ({
      status: 'connected',
      tools: toolNames.map((name) => ({ name, description: '', parameters: {}, source: 'mcp:obsidian' }))
    }),
    async callTool(_serverId: string, name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'vault_write' && failWrite) {
        return { content: [{ type: 'text', text: 'temporary disconnect' }], isError: true };
      }
      if (name === 'vault_read') {
        return { content: [{ type: 'text', text: JSON.stringify({ content: '# note' }) }] };
      }
      if (name === 'search_simple') return { content: [{ type: 'text', text: '[]' }] };
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'OK' }) }] };
    }
  };
}

beforeEach(() => {
  db = createTestDbFromSchema(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL);
    CREATE TABLE knowledge_outbox (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  db.prepare('INSERT INTO projects (id, name, config) VALUES (?, ?, ?)').run(
    'p', 'Project', JSON.stringify({
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/Project', allowAutomationWrites: true }
    })
  );
});

afterEach(() => db.close());

describe('KnowledgeService', () => {
  test('rejects traversal before calling the MCP server', async () => {
    const mcp = manager();
    const service = new KnowledgeService(mcp as never);

    await expect(service.read('p', '../Secrets.md')).rejects.toThrow(/traverse/);
    expect(mcp.calls).toEqual([]);
  });

  test('fails closed when a required capability is missing', async () => {
    const mcp = manager(ALL_TOOLS.filter((name) => name !== 'search_simple'));
    const service = new KnowledgeService(mcp as never);

    await expect(service.search('p', 'question')).rejects.toThrow(/missing required capability: search/);
  });

  test('requires project consent for automated writes', async () => {
    db.prepare('UPDATE projects SET config = ? WHERE id = ?').run(JSON.stringify({
      knowledge: { provider: 'obsidian', serverId: 'obsidian', folder: 'Hive/Project' }
    }), 'p');
    const mcp = manager();
    const service = new KnowledgeService(mcp as never);

    await expect(service.capture({ projectId: 'p', content: 'raw thought' }, { automated: true }))
      .rejects.toThrow(/Automated knowledge writes are disabled/);
    expect(mcp.calls).toEqual([]);
  });

  test('queues failed captures and deletes them after an explicit retry succeeds', async () => {
    const mcp = manager();
    mcp.setFailWrite(true);
    const service = new KnowledgeService(mcp as never);

    const captured = await service.capture({ projectId: 'p', content: 'raw thought', source: 'browser' });
    expect(captured.queued).toBe(true);
    expect(db.prepare('SELECT attempts FROM knowledge_outbox').get()).toEqual({ attempts: 1 });

    mcp.setFailWrite(false);
    await expect(service.retryOutbox('p')).resolves.toEqual({ retried: 1, delivered: 1, failed: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM knowledge_outbox').get()).toEqual({ count: 0 });
    expect(mcp.calls.at(-1)?.name).toBe('vault_write');
    expect(mcp.calls.at(-1)?.args.path).toMatch(/^Hive\/Project\/Inbox\/Raw\//);
  });
});
