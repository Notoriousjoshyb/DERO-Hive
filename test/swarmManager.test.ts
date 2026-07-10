import { describe, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, type TestDb } from './helpers/sqlite';

const state = vi.hoisted(() => ({
  db: null as unknown,
  tools: [] as string[][],
  buildEdits: false,
  rounds: {} as Record<string, number>,
  nextWorker: 0,
  workerFiles: {} as Record<string, string>,
  nativeToolScope: 'none' as 'none' | 'cwd-confined' | 'unconfined',
  nativeExecutionModes: [] as Array<'read-only'>,
  requestedModes: [] as Array<'read-only' | undefined>,
  gitRedirect: '',
  gitDenials: 0
}));

vi.mock('../src/main/db/client', () => ({
  getDb: () => state.db,
  getSetting: () => undefined
}));

vi.mock('../src/main/providers/registry', () => ({
  getAdapter: () => ({
    id: 'fake',
    nativeToolScope: state.nativeToolScope,
    nativeExecutionModes: state.nativeExecutionModes,
    async *stream(req: {
      tools?: Array<{ name: string }>;
      conversationId: string;
      nativeExecutionMode?: 'read-only';
      messages: Array<{ role: string; content: unknown }>;
    }) {
      const tools = (req.tools || []).map((tool) => tool.name);
      state.tools.push(tools);
      state.requestedModes.push(req.nativeExecutionMode);
      const round = state.rounds[req.conversationId] || 0;
      state.rounds[req.conversationId] = round + 1;
      if (state.gitRedirect && tools.includes('write_file') && round === 0) {
        yield { type: 'tool_calls', toolCalls: [{ id: 'redirect-git', name: 'write_file', arguments: JSON.stringify({ path: '.git', content: state.gitRedirect }) }] };
        yield { type: 'done' };
        return;
      }
      if (state.gitRedirect && tools.includes('write_file') && round === 1) {
        if (req.messages.some((message) => message.role === 'tool' && String(message.content).includes('cannot write Git metadata'))) state.gitDenials++;
        yield { type: 'delta', content: `redirect denied for ${req.conversationId}` };
        yield { type: 'done' };
        return;
      }
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
      integration_head TEXT, result TEXT, error TEXT, created_at INTEGER, updated_at INTEGER
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
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    state.requestedModes = [];
    state.gitRedirect = '';
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
    expect(state.requestedModes.every((mode) => mode === 'read-only')).toBe(true);
    db.close();
  });

  test('refuses unconfined native-tool providers for research and build before persistence', async () => {
    const db = makeDb();
    state.db = db;
    state.nativeToolScope = 'unconfined';
    state.nativeExecutionModes = ['read-only'];
    const manager = new SwarmManager(() => undefined);
    await expect(manager.start({ prompt: 'unsafe research', mode: 'research', providerId: 'fake', model: 'fake-model' }))
      .rejects.toThrow(/path-confined/);
    await expect(manager.start({ prompt: 'unsafe build', mode: 'build', providerId: 'fake', model: 'fake-model' }))
      .rejects.toThrow(/path-confined/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM swarm_runs').get()).toEqual({ count: 0 });
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
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
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    state.requestedModes = [];
    state.gitRedirect = '';
    const repo = mkdtempSync(join(tmpdir(), 'hive-native-swarm-'));
    execFileSync('git', ['init', '-b', 'main', repo]);
    writeFileSync(join(repo, 'base.txt'), 'base');
    execFileSync('git', ['-C', repo, 'add', 'base.txt']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', '']);
    execFileSync('git', ['-C', repo, 'config', 'user.email', '']);
    db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('p1', repo);

    let finish!: (run: import('../src/shared/types').SwarmRun) => void;
    const finished = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
    const manager = new SwarmManager((run) => {
      if (run.status === 'awaiting_apply' || run.status === 'failed') finish(run);
    });
    await manager.start({ prompt: 'Create isolated worker files', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'p1' });
    const ready = await finished;
    expect(ready.status).toBe('awaiting_apply');
    expect(ready.integrationHead).toMatch(/^[0-9a-f]{40,64}$/);
    expect(execFileSync('git', ['-C', repo, 'rev-parse', ready.integrationBranch!], { encoding: 'utf8' }).trim()).toBe(ready.integrationHead);
    expect(readdirSync(repo).filter((name) => name.startsWith('worker-'))).toEqual([]);
    expect(ready.integrationPath && existsSync(join(ready.integrationPath, 'worker-1.txt'))).toBe(true);

    const dirtyIntegrationFile = join(ready.integrationPath!, 'unreviewed.txt');
    writeFileSync(dirtyIntegrationFile, 'unreviewed');
    await expect(manager.apply(ready.id)).rejects.toThrow(/clean repository/);
    unlinkSync(dirtyIntegrationFile);

    writeFileSync(join(ready.integrationPath!, 'ref-drift.txt'), 'drift');
    execFileSync('git', ['-C', ready.integrationPath!, 'add', 'ref-drift.txt']);
    execFileSync('git', ['-C', ready.integrationPath!, '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'commit.gpgSign=false', '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'drift']);
    await expect(manager.apply(ready.id)).rejects.toThrow(/integration branch changed/);
    execFileSync('git', ['-C', ready.integrationPath!, 'reset', '--hard', ready.integrationHead!]);

    const applied = await manager.apply(ready.id);
    expect(applied.status).toBe('applied');
    expect(readdirSync(repo).filter((name) => name.startsWith('worker-'))).toHaveLength(4);
    db.close();
    rmSync(repo, { recursive: true, force: true });
  }, 20_000);

  test('denies a worker attempt to redirect its linked-worktree .git file', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = false;
    state.rounds = {};
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    state.requestedModes = [];
    state.gitDenials = 0;
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-git-redirect-'));
    execFileSync('git', ['init', '-b', 'main', repo]);
    writeFileSync(join(repo, 'base.txt'), 'base');
    execFileSync('git', ['-C', repo, 'add', 'base.txt']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
    const baseHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    state.gitRedirect = `gitdir: ${join(repo, '.git')}`;
    db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('redirect-project', repo);

    let finish!: (run: import('../src/shared/types').SwarmRun) => void;
    const finished = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
    const manager = new SwarmManager((run) => {
      if (run.status === 'awaiting_apply' || run.status === 'failed') finish(run);
    });
    await manager.start({ prompt: 'redirect git metadata', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'redirect-project' });
    const ready = await finished;
    expect(ready.status).toBe('awaiting_apply');
    expect(state.gitDenials).toBe(4);
    expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(baseHead);
    for (const task of ready.tasks.filter((item) => item.phase === 'worker')) {
      expect(readFileSync(join(task.worktreePath!, '.git'), 'utf8').trim()).not.toBe(state.gitRedirect);
    }
    await manager.apply(ready.id);
    state.gitRedirect = '';
    db.close();
    rmSync(repo, { recursive: true, force: true });
  }, 20_000);

  test('disables repository hooks for worker commits and integration merges', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    state.gitRedirect = '';
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-hooks-'));
    const marker = `${repo}-hook-ran`;
    const previousMarker = process.env.SWARM_HOOK_MARKER;
    process.env.SWARM_HOOK_MARKER = marker;
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      const hooks = join(repo, '.githooks');
      const hookScript = '#!/bin/sh\nprintf hook > "$SWARM_HOOK_MARKER"\n';
      writeFileSync(join(repo, 'base.txt'), 'base');
      mkdirSync(hooks, { recursive: true });
      writeFileSync(join(hooks, 'pre-commit'), hookScript);
      writeFileSync(join(hooks, 'pre-merge-commit'), hookScript);
      chmodSync(join(hooks, 'pre-commit'), 0o755);
      chmodSync(join(hooks, 'pre-merge-commit'), 0o755);
      execFileSync('git', ['-C', repo, 'add', '.']);
      execFileSync('git', ['-C', repo, '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', '.githooks']);
      writeFileSync(join(repo, 'base.txt'), 'hook control');
      execFileSync('git', ['-C', repo, 'add', 'base.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'control']);
      expect(existsSync(marker)).toBe(true);
      unlinkSync(marker);
      execFileSync('git', ['-C', repo, 'config', 'user.name', '']);
      execFileSync('git', ['-C', repo, 'config', 'user.email', '']);
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('hooks-project', repo);

      let finish!: (run: import('../src/shared/types').SwarmRun) => void;
      const finished = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
      const manager = new SwarmManager((run) => {
        if (run.status === 'awaiting_apply' || run.status === 'failed') finish(run);
      });
      await manager.start({ prompt: 'edit without hooks', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'hooks-project' });
      const ready = await finished;
      expect(ready.status).toBe('awaiting_apply');
      expect(ready.tasks.filter((task) => task.phase === 'worker' && task.status === 'completed')).toHaveLength(4);
      expect(existsSync(marker)).toBe(false);
      await manager.apply(ready.id);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (previousMarker === undefined) delete process.env.SWARM_HOOK_MARKER;
      else process.env.SWARM_HOOK_MARKER = previousMarker;
      if (existsSync(marker)) unlinkSync(marker);
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);
});
