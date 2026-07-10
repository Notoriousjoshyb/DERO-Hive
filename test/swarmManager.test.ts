import { describe, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from './helpers/sqlite';

const state = vi.hoisted(() => ({
  db: null as unknown,
  tools: [] as string[][],
  buildEdits: false,
  rounds: {} as Record<string, number>,
  nextWorker: 0,
  workerFiles: {} as Record<string, string>
}));

vi.mock('../src/main/db/client', () => ({
  getDb: () => state.db,
  getSetting: () => undefined
}));

vi.mock('../src/main/providers/registry', () => ({
  getAdapter: () => ({
    id: 'fake',
    async *stream(req: { tools?: Array<{ name: string }>; conversationId: string }) {
      const tools = (req.tools || []).map((tool) => tool.name);
      state.tools.push(tools);
      const round = state.rounds[req.conversationId] || 0;
      state.rounds[req.conversationId] = round + 1;
      if (state.buildEdits && tools.includes('write_file') && round === 0) {
        const filename = state.workerFiles[req.conversationId] ||= `worker-${++state.nextWorker}.txt`;
        yield { type: 'tool_calls', toolCalls: [{ id: `call-${filename}`, name: 'write_file', arguments: JSON.stringify({ path: filename, content: filename }) }] };
        yield { type: 'done' };
        return;
      }
      yield { type: 'delta', content: `report from ${req.conversationId}` };
      yield { type: 'done' };
    }
  }),
  closeConversationSessions: async () => undefined
}));

const { SwarmManager } = await import('../src/main/swarm/manager');

function makeDb(): TestDb {
  const db = createTestDb();
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT);
    ALTER TABLE conversations ADD COLUMN created_at INTEGER;
    ALTER TABLE conversations ADD COLUMN provider_id TEXT;
    ALTER TABLE conversations ADD COLUMN model TEXT;
    ALTER TABLE conversations ADD COLUMN project_id TEXT;
    ALTER TABLE conversations ADD COLUMN system_prompt TEXT;
    CREATE TABLE swarm_runs (
      id TEXT PRIMARY KEY, conversation_id TEXT, project_id TEXT, prompt TEXT, mode TEXT,
      status TEXT, provider_id TEXT, model TEXT, worker_count INTEGER, repo_root TEXT,
      base_branch TEXT, base_head TEXT, integration_branch TEXT, integration_path TEXT,
      result TEXT, error TEXT, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE swarm_tasks (
      id TEXT PRIMARY KEY, run_id TEXT, phase TEXT, task_index INTEGER, status TEXT,
      output TEXT, error TEXT, worktree_path TEXT, branch_name TEXT,
      started_at INTEGER, completed_at INTEGER
    );
  `);
  return db;
}

describe('SwarmManager research pipeline', () => {
  test('persists workers, verifier, and synthesizer while exposing read-only tools', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = false;
    state.rounds = {};
    let finish!: (run: import('../src/shared/types').SwarmRun) => void;
    const completed = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
    const manager = new SwarmManager((run) => {
      if (run.status === 'completed') finish(run);
    });

    const started = await manager.start({
      prompt: 'Map the code without changing it',
      mode: 'research',
      providerId: 'fake',
      model: 'fake-model'
    });
    expect(started.workerCount).toBe(4);

    const final = await completed;
    expect(final.tasks).toHaveLength(6);
    expect(final.tasks.map((task) => task.phase)).toEqual(['worker', 'worker', 'worker', 'worker', 'verifier', 'synthesizer']);
    expect(final.tasks.every((task) => task.status === 'completed')).toBe(true);
    expect(final.result).toContain('report from swarm:');
    expect(state.tools.flat()).not.toEqual(expect.arrayContaining(['write_file', 'edit_file', 'run_shell']));
    db.close();
  });

  test('keeps build edits off the user branch until explicit Apply', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    const repo = mkdtempSync(join(tmpdir(), 'hive-native-swarm-'));
    execFileSync('git', ['init', '-b', 'main', repo]);
    writeFileSync(join(repo, 'base.txt'), 'base');
    execFileSync('git', ['-C', repo, 'add', 'base.txt']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
    db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('p1', repo);

    let finish!: (run: import('../src/shared/types').SwarmRun) => void;
    const finished = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
    const manager = new SwarmManager((run) => {
      if (run.status === 'awaiting_apply' || run.status === 'failed') finish(run);
    });
    await manager.start({ prompt: 'Create isolated worker files', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'p1' });
    const ready = await finished;
    expect(ready.status).toBe('awaiting_apply');
    expect(readdirSync(repo).filter((name) => name.startsWith('worker-'))).toEqual([]);
    expect(ready.integrationPath && existsSync(join(ready.integrationPath, 'worker-1.txt'))).toBe(true);

    const applied = await manager.apply(ready.id);
    expect(applied.status).toBe('applied');
    expect(readdirSync(repo).filter((name) => name.startsWith('worker-'))).toHaveLength(4);
    db.close();
    rmSync(repo, { recursive: true, force: true });
  }, 20_000);
});
