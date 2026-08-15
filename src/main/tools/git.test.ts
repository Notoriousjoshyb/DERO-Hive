import assert from 'node:assert/strict';
import { parseStatus, parseLog, formatStatus, assertSafeArg, LOG_FORMAT } from './git';

// ── porcelain -z parsing ─────────────────────────────────────────────────
{
  // Records are NUL-terminated; a rename puts the source in the next record.
  const out = [
    '## feature/x...origin/feature/x [ahead 2, behind 1]',
    'M  src/a.ts',
    ' M src/b.ts',
    '?? notes.md',
    'R  new name.ts',
    'old name.ts'
  ].join('\0') + '\0';

  const status = parseStatus(out);
  assert.equal(status.branch, 'feature/x');
  assert.equal(status.upstream, 'origin/feature/x');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.clean, false);
  assert.equal(status.entries.length, 4);

  const staged = status.entries.filter((e) => e.staged).map((e) => e.path);
  assert.deepEqual(staged, ['src/a.ts', 'new name.ts'], 'a path with a space must survive intact');

  const untracked = status.entries.filter((e) => e.untracked).map((e) => e.path);
  assert.deepEqual(untracked, ['notes.md']);
  assert.equal(status.entries.find((e) => e.code === 'R ')?.renamedFrom, 'old name.ts');
}

// ── clean tree ───────────────────────────────────────────────────────────
{
  const status = parseStatus('## main...origin/main\0');
  assert.equal(status.clean, true);
  assert.equal(status.ahead, 0);
  assert.match(formatStatus(status), /Working tree clean/);
}

// ── detached HEAD ────────────────────────────────────────────────────────
{
  const status = parseStatus('## HEAD (no branch)\0');
  assert.equal(status.branch, null);
  assert.match(formatStatus(status), /Detached HEAD/);
}

// ── log parsing ──────────────────────────────────────────────────────────
{
  assert.equal(LOG_FORMAT.includes('%x1f'), true, 'fields are unit-separated so subjects cannot break parsing');
  const raw = [
    ['a'.repeat(40), 'Ada Lovelace', '2026-08-15T10:00:00+01:00', 'Fix the thing'].join('\x1f'),
    ['b'.repeat(40), 'Alan Turing', '2026-08-14T09:00:00+01:00', 'Subject with | pipes and, commas'].join('\x1f')
  ].join('\n');
  const commits = parseLog(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].shortHash, 'aaaaaaaa');
  assert.equal(commits[0].author, 'Ada Lovelace');
  assert.equal(commits[1].subject, 'Subject with | pipes and, commas');
  assert.deepEqual(parseLog(''), []);
}

// ── option injection through a ref or path is refused ────────────────────
{
  assert.throws(() => assertSafeArg('base', '--upload-pack=evil'), /must not start with/);
  assert.throws(() => assertSafeArg('branch', '-f'), /must not start with/);
  assert.doesNotThrow(() => assertSafeArg('branch', 'feature/ok'));
}

console.log('git.test.ts passed');
