import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// paths/logger resolve off HIVE_DATA_DIR outside Electron, so set it first.
const root = mkdtempSync(join(tmpdir(), 'hive-jobs-'));
process.env.HIVE_DATA_DIR = root;
process.env.HIVE_CLI = '1';

const CONV = 'conv-jobs-1';

function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function main(): Promise<void> {
  const { JobRegistry, jobs, startShellJob } = await import('./jobs');

  // ── the registry knows nothing about shells ─────────────────────────────
  {
    const reg = new JobRegistry();
    let killed = 0;
    const rec = reg.register({ kind: 'shell', label: 'fake', conversationId: CONV, kill: () => { killed++; } });
    assert.equal(rec.status, 'running');
    assert.equal(rec.id, 'job_1');

    reg.append(rec.id, 'hello ');
    reg.append(rec.id, 'world');
    const first = reg.read(rec.id);
    assert.equal(first?.text, 'hello world');
    assert.equal(first?.cursor, 11);
    assert.equal(first?.done, false, 'a running job is never done');

    // A cursor read returns only what is new.
    reg.append(rec.id, '!');
    const next = reg.read(rec.id, first!.cursor);
    assert.equal(next?.text, '!');

    assert.equal(reg.kill(rec.id), true);
    assert.equal(killed, 1);
    assert.equal(reg.get(rec.id)?.status, 'killed');
    assert.equal(reg.kill(rec.id), false, 'killing a finished job reports false');

    // The completion notice is delivered exactly once.
    const notices = reg.drainNotices(CONV);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /job_1/);
    assert.deepEqual(reg.drainNotices(CONV), []);
    assert.deepEqual(reg.drainNotices('other-conversation'), [], 'notices are per conversation');
  }

  // ── falling behind the retained window is reported, not hidden ──────────
  {
    const reg = new JobRegistry();
    const rec = reg.register({ kind: 'shell', label: 'noisy', conversationId: CONV, kill: () => {} });
    reg.append(rec.id, 'a'.repeat(250_000));
    const read = reg.read(rec.id, 0, 10);
    assert.ok(read);
    assert.ok(read.dropped > 0, 'a reader starting at 0 after overflow must be told what it missed');
    assert.equal(reg.get(rec.id)?.totalChars, 250_000);
  }

  // ── a real background command ───────────────────────────────────────────
  {
    const isWin = process.platform === 'win32';
    const rec = startShellJob({
      command: isWin ? 'Write-Output "background-ok"' : 'echo background-ok',
      cwd: root,
      conversationId: CONV
    });
    assert.equal(rec.status, 'running', 'startShellJob returns before the command finishes');
    await waitFor(() => jobs.get(rec.id)?.status !== 'running');
    const done = jobs.get(rec.id);
    assert.equal(done?.status, 'exited');
    assert.equal(done?.exitCode, 0);
    const out = jobs.read(rec.id);
    assert.match(out!.text, /background-ok/);
    assert.equal(out!.done, true);
    jobs.clear();
  }
}

main()
  .then(() => {
    rmSync(root, { recursive: true, force: true });
    console.log('jobs.test.ts passed');
  })
  .catch((err) => {
    rmSync(root, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
  });
