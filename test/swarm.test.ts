import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clampWorkerCount, isForbiddenSwarmWritePath, markInterruptedSwarmRuns, runPool, swarmToolNames, verifyRepositorySnapshot } from '../src/main/swarm/manager';
import { createTestDb } from './helpers/sqlite';

describe('native swarm', () => {
  test('applies only by fast-forward and never checks out or resets the user branch', () => {
    const source = readFileSync('src/main/swarm/manager.ts', 'utf8');
    expect(source).toContain("'merge', '--ff-only'");
    expect(source).not.toMatch(/git\(run\.repoRoot[^\n]+['"](?:checkout|reset)['"]/);
  });

  test('defaults to four workers, caps at eight, and runs at concurrency three', async () => {
    expect(clampWorkerCount(undefined)).toBe(4);
    expect(clampWorkerCount(99)).toBe(8);
    expect(swarmToolNames(false)).not.toEqual(expect.arrayContaining(['write_file', 'edit_file', 'run_shell']));
    expect(swarmToolNames(true)).toEqual(expect.arrayContaining(['write_file', 'edit_file']));
    expect(swarmToolNames(true)).not.toContain('run_shell');
    let active = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6], 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(peak).toBe(3);
  });

  test('denies Git metadata write aliases without blocking ordinary dotfiles', () => {
    for (const path of ['.git', '.GIT/config', 'nested\\.git\\config', '.git.', '.git ', '.git:stream', '.git::$DATA']) {
      expect(isForbiddenSwarmWritePath(path, repo)).toBe(true);
    }
    expect(isForbiddenSwarmWritePath('.gitignore', repo)).toBe(false);
    expect(isForbiddenSwarmWritePath('docs/example.git/config', repo)).toBe(false);
  });

  test('marks only in-flight persisted work interrupted', () => {
    const db = createTestDb();
    db.exec(`
      CREATE TABLE swarm_runs (id TEXT PRIMARY KEY, status TEXT, error TEXT, updated_at INTEGER);
      CREATE TABLE swarm_tasks (id TEXT PRIMARY KEY, status TEXT, error TEXT, completed_at INTEGER);
      INSERT INTO swarm_runs VALUES ('running', 'running', NULL, 0), ('done', 'completed', NULL, 0);
      INSERT INTO swarm_tasks VALUES ('queued', 'queued', NULL, NULL), ('task-done', 'completed', NULL, 1);
    `);
    markInterruptedSwarmRuns(db as never, 123);
    expect(db.prepare('SELECT status FROM swarm_runs WHERE id = ?').get('running')).toEqual({ status: 'interrupted' });
    expect(db.prepare('SELECT status FROM swarm_runs WHERE id = ?').get('done')).toEqual({ status: 'completed' });
    expect(db.prepare('SELECT status FROM swarm_tasks WHERE id = ?').get('queued')).toEqual({ status: 'interrupted' });
    expect(db.prepare('SELECT status FROM swarm_tasks WHERE id = ?').get('task-done')).toEqual({ status: 'completed' });
    db.close();
  });
});

const repo = mkdtempSync(join(tmpdir(), 'hive-swarm-git-'));
execFileSync('git', ['init', '-b', 'main', repo]);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'Swarm Test']);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'swarm@test.invalid']);
writeFileSync(join(repo, 'file.txt'), 'base');
execFileSync('git', ['-C', repo, 'add', 'file.txt']);
execFileSync('git', ['-C', repo, 'commit', '-m', 'base']);
const baseHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

afterAll(() => rmSync(repo, { recursive: true, force: true }));

test('build snapshot refuses dirty repositories and HEAD drift', async () => {
  await expect(verifyRepositorySnapshot(repo, 'main', baseHead)).resolves.toBeUndefined();
  const previousGitDir = process.env.GIT_DIR;
  process.env.GIT_DIR = join(repo, 'redirected.git');
  try {
    await expect(verifyRepositorySnapshot(repo, 'main', baseHead)).resolves.toBeUndefined();
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
  }
  writeFileSync(join(repo, 'dirty.txt'), 'dirty');
  await expect(verifyRepositorySnapshot(repo, 'main', baseHead)).rejects.toThrow(/clean repository/);
  unlinkSync(join(repo, 'dirty.txt'));
  writeFileSync(join(repo, 'file.txt'), 'next');
  execFileSync('git', ['-C', repo, 'add', 'file.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'drift']);
  await expect(verifyRepositorySnapshot(repo, 'main', baseHead)).rejects.toThrow(/HEAD changed/);
});
