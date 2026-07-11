import { describe, expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
  gitDenials: 0,
  workerContent: '',
  pauseAfterTool: null as Promise<void> | null,
  afterToolReached: null as (() => void) | null,
  incomingDriverAttack: false
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
        const toolCalls = state.incomingDriverAttack && filename === 'worker-1.txt'
          ? [
              { id: 'incoming-attrs', name: 'write_file', arguments: JSON.stringify({ path: '.gitattributes', content: 'victim.txt filter=swarmtest\n' }) },
              { id: 'incoming-filter', name: 'write_file', arguments: JSON.stringify({ path: 'filter.sh', content: '#!/bin/sh\ncat\nprintf ran > "$SWARM_INCOMING_MARKER"\n' }) },
              { id: 'incoming-victim', name: 'write_file', arguments: JSON.stringify({ path: 'victim.txt', content: 'victim\n' }) }
            ]
          : [{ id: `call-${filename}`, name: 'write_file', arguments: JSON.stringify({ path: filename, content: state.workerContent || filename }) }];
        yield { type: 'tool_calls', toolCalls };
        yield { type: 'done' };
        return;
      }
      if (state.buildEdits && tools.includes('write_file') && round === 1 && state.pauseAfterTool) {
        state.afterToolReached?.();
        await state.pauseAfterTool;
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
    expect(started.workerCount).toBe(3);

    const final = await completed;
    expect(final.tasks).toHaveLength(5);
    expect(final.tasks.map((task) => task.phase)).toEqual(['worker', 'worker', 'worker', 'verifier', 'synthesizer']);
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
    execFileSync('git', ['-C', repo, 'config', 'filter.unused.clean', './must-not-run']);
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
    const integrationGitFile = join(ready.integrationPath!, '.git');
    if (process.platform === 'win32') execFileSync('attrib', ['-H', '-R', integrationGitFile]);
    else chmodSync(integrationGitFile, 0o666);
    writeFileSync(integrationGitFile, `gitdir: ${join(repo, '.git')}`);

    const applied = await manager.apply(ready.id);
    expect(applied.status).toBe('applied');
    expect(readdirSync(repo).filter((name) => name.startsWith('worker-'))).toHaveLength(3);
    const integrationParent = dirname(ready.integrationPath!);
    const quarantined = readdirSync(integrationParent).filter((name) => name.startsWith('integration.invalid-'));
    expect(quarantined.length).toBeGreaterThan(0);
    for (const name of quarantined) rmSync(join(integrationParent, name), { recursive: true, force: true });
    db.close();
    rmSync(repo, { recursive: true, force: true });
  }, 60_000);

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
    expect(state.gitDenials).toBe(3);
    expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(baseHead);
    for (const task of ready.tasks.filter((item) => item.phase === 'worker')) {
      expect(readFileSync(join(task.worktreePath!, '.git'), 'utf8').trim()).not.toBe(state.gitRedirect);
    }
    await manager.apply(ready.id);
    state.gitRedirect = '';
    db.close();
    rmSync(repo, { recursive: true, force: true });
  }, 60_000);

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
      expect(ready.tasks.filter((task) => task.phase === 'worker' && task.status === 'completed')).toHaveLength(3);
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
  }, 60_000);

  test('reconciles applying intent before and after the base-ref CAS without touching a sibling branch', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    state.workerContent = '';
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-apply-recovery-'));
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      writeFileSync(join(repo, 'base.txt'), 'base');
      execFileSync('git', ['-C', repo, 'add', 'base.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('apply-recovery-project', repo);

      let readyResolve!: (run: import('../src/shared/types').SwarmRun) => void;
      const readyPromise = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { readyResolve = resolve; });
      const manager = new SwarmManager((run) => {
        if (run.status === 'awaiting_apply') readyResolve(run);
      });
      await manager.start({ prompt: 'one recoverable edit', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'apply-recovery-project', workerCount: 1 });
      const ready = await readyPromise;

      execFileSync('git', ['-C', repo, 'switch', '-c', 'sibling']);
      const siblingHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      await expect(manager.apply(ready.id)).rejects.toThrow(/expected branch main/);
      expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(siblingHead);
      db.prepare("UPDATE swarm_runs SET status = 'applying' WHERE id = ?").run(ready.id);

      let awaitingResolve!: (run: import('../src/shared/types').SwarmRun) => void;
      const awaitingPromise = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { awaitingResolve = resolve; });
      new SwarmManager((run) => { if (run.id === ready.id && run.status === 'awaiting_apply') awaitingResolve(run); });
      const restored = await awaitingPromise;
      expect(restored.status).toBe('awaiting_apply');
      expect(execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('sibling');
      expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(siblingHead);

      execFileSync('git', ['-C', repo, 'switch', 'main']);
      db.prepare("UPDATE swarm_runs SET status = 'applying' WHERE id = ?").run(ready.id);
      execFileSync('git', ['-C', repo, 'update-ref', 'refs/heads/main', ready.integrationHead!, ready.baseHead!]);
      let appliedResolve!: (run: import('../src/shared/types').SwarmRun) => void;
      const appliedPromise = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { appliedResolve = resolve; });
      new SwarmManager((run) => { if (run.id === ready.id && run.status === 'applied') appliedResolve(run); });
      const recovered = await appliedPromise;
      expect(recovered.status).toBe('applied');
      expect(execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('main');
      expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(ready.integrationHead);
      expect(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
      expect(existsSync(join(repo, 'worker-1.txt'))).toBe(true);
    } finally {
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  test('aborted partial workers are quarantined, recreated from base, and rerun before completion', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    state.workerContent = 'partial';
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-resume-clean-'));
    const quarantines: string[] = [];
    let releaseTool!: () => void;
    let reachedTool!: () => void;
    state.pauseAfterTool = new Promise<void>((resolve) => { releaseTool = resolve; });
    const afterTool = new Promise<void>((resolve) => { reachedTool = resolve; });
    state.afterToolReached = reachedTool;
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      writeFileSync(join(repo, 'base.txt'), 'base');
      execFileSync('git', ['-C', repo, 'add', 'base.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('resume-clean-project', repo);

      let readyResolve!: (run: import('../src/shared/types').SwarmRun) => void;
      const readyPromise = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { readyResolve = resolve; });
      const manager = new SwarmManager((run) => {
        if (run.status === 'awaiting_apply') readyResolve(run);
      });
      const started = await manager.start({ prompt: 'rerun partial edit', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'resume-clean-project', workerCount: 1 });
      await afterTool;
      const runningTask = manager.get(started.id)!.tasks.find((task) => task.phase === 'worker')!;
      expect(runningTask.status).toBe('running');
      expect(readFileSync(join(runningTask.worktreePath!, 'worker-1.txt'), 'utf8')).toBe('partial');
      execFileSync('git', ['-C', runningTask.worktreePath!, 'add', '-A']);
      execFileSync('git', ['-C', runningTask.worktreePath!, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'partial']);
      const partialHead = execFileSync('git', ['-C', runningTask.worktreePath!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const workerGitFile = join(runningTask.worktreePath!, '.git');
      if (process.platform === 'win32') execFileSync('attrib', ['-H', '-R', workerGitFile]);
      else chmodSync(workerGitFile, 0o666);
      writeFileSync(workerGitFile, `gitdir: ${join(repo, '.git')}`);

      manager.abort(started.id);
      releaseTool();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(manager.get(started.id)!.tasks.find((task) => task.id === runningTask.id)?.status).toBe('aborted');

      state.pauseAfterTool = null;
      state.afterToolReached = null;
      state.rounds = {};
      state.nextWorker = 0;
      state.workerFiles = {};
      state.workerContent = 'final';
      await manager.resume(started.id);
      const ready = await readyPromise;
      const rerunTask = ready.tasks.find((task) => task.phase === 'worker')!;
      expect(rerunTask.status).toBe('completed');
      expect(readFileSync(join(ready.integrationPath!, 'worker-1.txt'), 'utf8')).toBe('final');
      const rerunHead = execFileSync('git', ['-C', repo, 'rev-parse', rerunTask.branchName!], { encoding: 'utf8' }).trim();
      expect(() => execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', partialHead, rerunHead])).toThrow();
      const parent = dirname(runningTask.worktreePath!);
      for (const name of readdirSync(parent).filter((entry) => entry.startsWith(`${basename(runningTask.worktreePath!)}.invalid-`))) {
        quarantines.push(join(parent, name));
      }
      expect(quarantines.length).toBeGreaterThan(0);
      await manager.apply(ready.id);
    } finally {
      state.pauseAfterTool = null;
      state.afterToolReached = null;
      state.workerContent = '';
      for (const path of quarantines) rmSync(path, { recursive: true, force: true });
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  test('audits the exact incoming worker commit before a fast-forward merge can run its filter', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    state.incomingDriverAttack = true;
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-incoming-filter-'));
    const marker = `${repo}-filter-ran`;
    const previousMarker = process.env.SWARM_INCOMING_MARKER;
    let swarmRoot = '';
    let armed = false;
    process.env.SWARM_INCOMING_MARKER = marker;
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      writeFileSync(join(repo, 'base.txt'), 'base');
      execFileSync('git', ['-C', repo, 'add', 'base.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      const baseHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('incoming-filter-project', repo);

      let finish!: (run: import('../src/shared/types').SwarmRun) => void;
      const finished = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
      const manager = new SwarmManager((run) => {
        const worker = run.tasks.find((task) => task.phase === 'worker');
        if (!armed && worker?.status === 'completed') {
          execFileSync('git', ['-C', repo, 'config', 'filter.swarmtest.smudge', 'sh filter.sh']);
          armed = true;
        }
        if (run.status === 'awaiting_apply' || run.status === 'failed') finish(run);
      });
      await manager.start({
        prompt: 'introduce a target-tree filter', mode: 'build', providerId: 'fake', model: 'fake-model',
        projectId: 'incoming-filter-project', workerCount: 1
      });
      const failed = await finished;
      swarmRoot = dirname(failed.integrationPath!);
      expect(armed).toBe(true);
      expect(failed.status).toBe('failed');
      expect(failed.tasks.find((task) => task.phase === 'worker')?.error)
        .toMatch(/active executable Git attributes.*filter=swarmtest/);
      expect(existsSync(marker)).toBe(false);
      expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(baseHead);
      expect(existsSync(join(repo, 'victim.txt'))).toBe(false);
    } finally {
      state.incomingDriverAttack = false;
      if (previousMarker === undefined) delete process.env.SWARM_INCOMING_MARKER;
      else process.env.SWARM_INCOMING_MARKER = previousMarker;
      if (existsSync(marker)) unlinkSync(marker);
      if (swarmRoot) rmSync(swarmRoot, { recursive: true, force: true });
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  test('audits an integration branch before recreating its missing worktree', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    state.incomingDriverAttack = false;
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-target-filter-'));
    const marker = `${repo}-filter-ran`;
    const previousMarker = process.env.SWARM_TARGET_MARKER;
    process.env.SWARM_TARGET_MARKER = marker;
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      writeFileSync(join(repo, 'base.txt'), 'base');
      execFileSync('git', ['-C', repo, 'add', 'base.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('target-filter-project', repo);

      let finish!: (run: import('../src/shared/types').SwarmRun) => void;
      const finished = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { finish = resolve; });
      const manager = new SwarmManager((run) => {
        if (run.status === 'awaiting_apply' || run.status === 'failed') finish(run);
      });
      await manager.start({
        prompt: 'prepare one normal edit', mode: 'build', providerId: 'fake', model: 'fake-model',
        projectId: 'target-filter-project', workerCount: 1
      });
      const ready = await finished;
      expect(ready.status).toBe('awaiting_apply');

      writeFileSync(join(ready.integrationPath!, '.gitattributes'), 'victim.txt filter=swarmtarget\n');
      writeFileSync(join(ready.integrationPath!, 'filter.sh'), '#!/bin/sh\ncat\nprintf ran > "$SWARM_TARGET_MARKER"\n');
      writeFileSync(join(ready.integrationPath!, 'victim.txt'), 'victim\n');
      execFileSync('git', ['-C', ready.integrationPath!, 'add', '.']);
      execFileSync('git', [
        '-C', ready.integrationPath!, '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
        '-c', 'commit.gpgSign=false', '-c', 'user.name=Test', '-c', 'user.email=test@invalid',
        'commit', '-m', 'unreviewed target filter'
      ]);
      const maliciousHead = execFileSync('git', ['-C', ready.integrationPath!, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      execFileSync('git', ['-C', repo, 'worktree', 'remove', ready.integrationPath!]);
      execFileSync('git', ['-C', repo, 'worktree', 'prune']);
      execFileSync('git', ['-C', repo, 'config', 'filter.swarmtarget.smudge', 'sh filter.sh']);

      await expect(manager.apply(ready.id)).rejects.toThrow(/active executable Git attributes.*filter=swarmtarget/);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(ready.integrationPath!)).toBe(false);
      expect(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(ready.baseHead);

      execFileSync('git', ['-C', repo, 'config', '--unset-all', 'filter.swarmtarget.smudge']);
      execFileSync('git', [
        '-C', repo, 'update-ref', `refs/heads/${ready.integrationBranch!}`, ready.integrationHead!, maliciousHead
      ]);
      const applied = await manager.apply(ready.id);
      expect(applied.status).toBe('applied');
      expect(existsSync(join(repo, 'worker-1.txt'))).toBe(true);
      expect(existsSync(marker)).toBe(false);
    } finally {
      state.incomingDriverAttack = false;
      if (previousMarker === undefined) delete process.env.SWARM_TARGET_MARKER;
      else process.env.SWARM_TARGET_MARKER = previousMarker;
      if (existsSync(marker)) unlinkSync(marker);
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  test('audits the pinned integration commit before post-CAS recovery materializes it', async () => {
    const db = makeDb();
    state.db = db;
    state.tools = [];
    state.buildEdits = true;
    state.rounds = {};
    state.nextWorker = 0;
    state.workerFiles = {};
    state.incomingDriverAttack = true;
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-recovery-filter-'));
    const marker = `${repo}-filter-ran`;
    const previousMarker = process.env.SWARM_INCOMING_MARKER;
    let swarmRoot = '';
    process.env.SWARM_INCOMING_MARKER = marker;
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      writeFileSync(join(repo, 'base.txt'), 'base');
      execFileSync('git', ['-C', repo, 'add', 'base.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('recovery-filter-project', repo);

      let readyResolve!: (run: import('../src/shared/types').SwarmRun) => void;
      const readyPromise = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { readyResolve = resolve; });
      const manager = new SwarmManager((run) => {
        if (run.status === 'awaiting_apply') readyResolve(run);
      });
      await manager.start({
        prompt: 'prepare a filtered integration tree', mode: 'build', providerId: 'fake', model: 'fake-model',
        projectId: 'recovery-filter-project', workerCount: 1
      });
      const ready = await readyPromise;
      swarmRoot = dirname(ready.integrationPath!);
      execFileSync('git', ['-C', repo, 'config', 'filter.swarmtest.smudge', 'sh filter.sh']);
      db.prepare("UPDATE swarm_runs SET status = 'applying' WHERE id = ?").run(ready.id);
      execFileSync('git', [
        '-C', repo, 'update-ref', 'refs/heads/main', ready.integrationHead!, ready.baseHead!
      ]);

      let pause!: (run: import('../src/shared/types').SwarmRun) => void;
      const pausedPromise = new Promise<import('../src/shared/types').SwarmRun>((resolve) => { pause = resolve; });
      const recovering = new SwarmManager((run) => {
        if (run.id === ready.id && run.status === 'applying' && run.error?.includes('recovery paused')) pause(run);
      });
      const paused = await pausedPromise;
      expect(recovering.get(ready.id)?.status).toBe('applying');
      expect(paused.error).toMatch(/active executable Git attributes.*filter=swarmtest/);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(repo, 'victim.txt'))).toBe(false);

      execFileSync('git', ['-C', repo, 'config', '--unset-all', 'filter.swarmtest.smudge']);
      const applied = await recovering.apply(ready.id);
      expect(applied.status).toBe('applied');
      expect(existsSync(join(repo, 'victim.txt'))).toBe(true);
      expect(existsSync(marker)).toBe(false);
    } finally {
      state.incomingDriverAttack = false;
      if (previousMarker === undefined) delete process.env.SWARM_INCOMING_MARKER;
      else process.env.SWARM_INCOMING_MARKER = previousMarker;
      if (existsSync(marker)) unlinkSync(marker);
      if (swarmRoot) rmSync(swarmRoot, { recursive: true, force: true });
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  test('refuses executable Git filters and merge drivers before they can run', async () => {
    const db = makeDb();
    state.db = db;
    state.nativeToolScope = 'none';
    state.nativeExecutionModes = [];
    const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-git-config-'));
    const marker = `${repo}-git-command-ran`;
    const previousMarker = process.env.SWARM_GIT_EXEC_MARKER;
    process.env.SWARM_GIT_EXEC_MARKER = marker;
    try {
      execFileSync('git', ['init', '-b', 'main', repo]);
      writeFileSync(join(repo, '.gitattributes'), 'filtered.txt filter=swarmtest diff=swarmtest\nmerged.txt merge=swarmtest\n');
      writeFileSync(join(repo, 'filtered.txt'), 'base\n');
      writeFileSync(join(repo, 'merged.txt'), 'base\n');
      writeFileSync(join(repo, 'filter.sh'), '#!/bin/sh\ncat\nprintf filter > "$SWARM_GIT_EXEC_MARKER"\n');
      writeFileSync(join(repo, 'merge.sh'), '#!/bin/sh\nprintf merge > "$SWARM_GIT_EXEC_MARKER"\ncp "$3" "$2"\n');
      chmodSync(join(repo, 'filter.sh'), 0o755);
      chmodSync(join(repo, 'merge.sh'), 0o755);
      execFileSync('git', ['-C', repo, 'add', '.']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@invalid', 'commit', '-m', 'base']);
      db.prepare('INSERT INTO projects (id, path) VALUES (?, ?)').run('git-config-project', repo);
      const manager = new SwarmManager(() => undefined);

      execFileSync('git', ['-C', repo, 'config', 'filter.swarmtest.clean', './filter.sh']);
      writeFileSync(join(repo, 'filtered.txt'), 'control\n');
      execFileSync('git', ['-C', repo, 'add', 'filtered.txt']);
      expect(existsSync(marker)).toBe(true);
      execFileSync('git', ['-C', repo, 'reset', '--hard', 'HEAD']);
      unlinkSync(marker);
      await expect(manager.start({ prompt: 'unsafe filter', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'git-config-project' }))
        .rejects.toThrow(/filter=swarmtest/);
      expect(existsSync(marker)).toBe(false);
      expect(db.prepare('SELECT COUNT(*) AS count FROM swarm_runs').get()).toEqual({ count: 0 });

      execFileSync('git', ['-C', repo, 'config', '--unset-all', 'filter.swarmtest.clean']);
      execFileSync('git', ['-C', repo, 'config', 'merge.swarmtest.driver', './merge.sh %O %A %B']);
      await expect(manager.start({ prompt: 'unsafe merge driver', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'git-config-project' }))
        .rejects.toThrow(/merge=swarmtest/);
      expect(existsSync(marker)).toBe(false);
      expect(db.prepare('SELECT COUNT(*) AS count FROM swarm_runs').get()).toEqual({ count: 0 });

      execFileSync('git', ['-C', repo, 'config', '--unset-all', 'merge.swarmtest.driver']);
      execFileSync('git', ['-C', repo, 'config', 'diff.swarmtest.command', './filter.sh']);
      await expect(manager.start({ prompt: 'unsafe diff driver', mode: 'build', providerId: 'fake', model: 'fake-model', projectId: 'git-config-project' }))
        .rejects.toThrow(/diff=swarmtest/);
      expect(existsSync(marker)).toBe(false);
      expect(db.prepare('SELECT COUNT(*) AS count FROM swarm_runs').get()).toEqual({ count: 0 });
    } finally {
      if (previousMarker === undefined) delete process.env.SWARM_GIT_EXEC_MARKER;
      else process.env.SWARM_GIT_EXEC_MARKER = previousMarker;
      if (existsSync(marker)) unlinkSync(marker);
      db.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 20_000);
});
