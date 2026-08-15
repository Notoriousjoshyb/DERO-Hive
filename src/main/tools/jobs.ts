import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { logger } from '../utils/logger';

/**
 * Background jobs: one kind-agnostic registry that every long-running producer
 * reports into, so `job_list` / `job_output` / `job_kill` are the only three
 * tools a model ever needs for background work.
 *
 * Adapted from the DeepSeek Harness job registry (MIT) — see
 * HARNESS_INTEGRATION_PLAN.md §2.3. The shape worth preserving is that the
 * registry knows nothing about shells: a producer hands over a label and a way
 * to stop itself, and pushes output. Adding PTY sends or subagents later means
 * calling register()/append()/finish(), not writing a second set of tools.
 */

/** What produced a job. New producers add a kind; the tools do not change. */
export type JobKind = 'shell';

export type JobStatus = 'running' | 'exited' | 'failed' | 'killed';

export interface JobRecord {
  id: string;
  kind: JobKind;
  /** Short human/model-readable summary, e.g. the command line. */
  label: string;
  conversationId: string;
  cwd?: string;
  status: JobStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: number;
  endedAt: number | null;
  /** Characters produced in total, including any dropped from the window. */
  totalChars: number;
  /** Characters dropped off the front of the retained window. */
  droppedChars: number;
}

export interface JobSpec {
  kind: JobKind;
  label: string;
  conversationId: string;
  cwd?: string;
  /** Stop the underlying work. Must be safe to call more than once. */
  kill: () => void;
}

export interface JobRead {
  text: string;
  /** Absolute character offset to pass back as `cursor` for the next read. */
  cursor: number;
  /** Characters that scrolled out of the retained window before this read. */
  dropped: number;
  /** True when the job has finished and the cursor is at the end of output. */
  done: boolean;
}

/** Output retained per job. Older output is dropped, and the drop is reported. */
const MAX_RETAINED_CHARS = 200_000;
/** Most output handed back in one job_output call. */
const DEFAULT_READ_CHARS = 20_000;
/** Finished jobs are forgotten after this, so the registry cannot grow forever. */
const FINISHED_TTL_MS = 30 * 60_000;
/** Hard ceiling on tracked jobs; the oldest finished ones are pruned first. */
const MAX_JOBS = 64;

interface JobEntry {
  record: JobRecord;
  retained: string;
  kill: () => void;
  /** Set once the completion notice has been handed to a conversation. */
  noticeDelivered: boolean;
}

export class JobRegistry extends EventEmitter {
  private jobs = new Map<string, JobEntry>();
  private seq = 0;

  /** Track a new job. The producer owns starting the work before calling this. */
  register(spec: JobSpec): JobRecord {
    this.prune();
    const id = `job_${++this.seq}`;
    const record: JobRecord = {
      id,
      kind: spec.kind,
      label: spec.label,
      conversationId: spec.conversationId,
      cwd: spec.cwd,
      status: 'running',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      endedAt: null,
      totalChars: 0,
      droppedChars: 0
    };
    this.jobs.set(id, { record, retained: '', kill: spec.kill, noticeDelivered: false });
    this.emit('start', record);
    return record;
  }

  /** Add output. Combined stdout+stderr, in arrival order. */
  append(id: string, chunk: string): void {
    const entry = this.jobs.get(id);
    if (!entry || !chunk) return;
    entry.retained += chunk;
    entry.record.totalChars += chunk.length;
    if (entry.retained.length > MAX_RETAINED_CHARS) {
      const excess = entry.retained.length - MAX_RETAINED_CHARS;
      entry.retained = entry.retained.slice(excess);
      entry.record.droppedChars += excess;
    }
  }

  /** Mark a job finished. Later calls for the same id are ignored. */
  finish(id: string, outcome: { status: Exclude<JobStatus, 'running'>; exitCode?: number | null; signal?: string | null }): void {
    const entry = this.jobs.get(id);
    if (!entry || entry.record.status !== 'running') return;
    entry.record.status = outcome.status;
    entry.record.exitCode = outcome.exitCode ?? null;
    entry.record.signal = outcome.signal ?? null;
    entry.record.endedAt = Date.now();
    this.emit('exit', entry.record);
  }

  get(id: string): JobRecord | null {
    return this.jobs.get(id)?.record ?? null;
  }

  /** Newest first. Pass a conversation id to see only that conversation's jobs. */
  list(conversationId?: string): JobRecord[] {
    const all = [...this.jobs.values()].map((e) => e.record);
    const scoped = conversationId ? all.filter((r) => r.conversationId === conversationId) : all;
    return scoped.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Read output from `cursor` onwards. The cursor is an absolute character
   * offset into the job's whole output, so a caller that falls behind the
   * retained window is told how much it missed rather than silently handed a
   * gap.
   */
  read(id: string, cursor = 0, maxChars = DEFAULT_READ_CHARS): JobRead | null {
    const entry = this.jobs.get(id);
    if (!entry) return null;
    const windowStart = entry.record.droppedChars;
    const from = Math.max(cursor, windowStart);
    const dropped = Math.max(0, windowStart - cursor);
    const slice = entry.retained.slice(from - windowStart, from - windowStart + maxChars);
    const next = from + slice.length;
    return {
      text: slice,
      cursor: next,
      dropped,
      done: entry.record.status !== 'running' && next >= entry.record.totalChars
    };
  }

  /** Stop a running job. Returns false for an unknown or already-finished id. */
  kill(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry || entry.record.status !== 'running') return false;
    try {
      entry.kill();
    } catch (err) {
      logger.warn('jobs', `kill failed for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // The producer normally confirms with finish(); mark it here too so a
    // producer that never calls back cannot leave a job stuck as running.
    this.finish(id, { status: 'killed' });
    return true;
  }

  /** Stop everything. Called on app shutdown so no child outlives the app. */
  killAll(): void {
    for (const [id, entry] of this.jobs) {
      if (entry.record.status === 'running') this.kill(id);
    }
  }

  /**
   * Completion notices a conversation has not been told about yet. The tool
   * layer appends these to the next tool result, which is the cheapest way to
   * get "your background job finished" in front of the model without a
   * dedicated event channel.
   */
  drainNotices(conversationId: string): string[] {
    const out: string[] = [];
    for (const entry of this.jobs.values()) {
      const r = entry.record;
      if (entry.noticeDelivered || r.status === 'running') continue;
      if (r.conversationId !== conversationId) continue;
      entry.noticeDelivered = true;
      const how = r.status === 'killed' ? 'was killed' : r.status === 'failed' ? 'failed to start' : `exited with code ${r.exitCode ?? 'unknown'}`;
      out.push(`Background ${r.id} (${r.label}) ${how}. Use job_output to read it.`);
    }
    return out;
  }

  /** Test seam: forget everything. */
  clear(): void {
    this.jobs.clear();
    this.seq = 0;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.jobs) {
      if (entry.record.endedAt && now - entry.record.endedAt > FINISHED_TTL_MS) this.jobs.delete(id);
    }
    if (this.jobs.size < MAX_JOBS) return;
    const finished = [...this.jobs.entries()]
      .filter(([, e]) => e.record.status !== 'running')
      .sort((a, b) => (a[1].record.endedAt ?? 0) - (b[1].record.endedAt ?? 0));
    for (const [id] of finished) {
      if (this.jobs.size < MAX_JOBS) break;
      this.jobs.delete(id);
    }
  }
}

/** Process-wide instance — the builtin tools and app shutdown share it. */
export const jobs = new JobRegistry();

/**
 * Start a shell command as a background job.
 *
 * The child is spawned in its own process group (POSIX) so a killed job takes
 * its children with it; on Windows the same is done with `taskkill /T`, because
 * killing the shell alone would orphan whatever it launched.
 */
export function startShellJob(opts: { command: string; cwd: string; conversationId: string }): JobRecord {
  const isWin = process.platform === 'win32';
  const child = spawn(
    isWin ? 'powershell.exe' : '/bin/sh',
    isWin ? ['-NoProfile', '-NonInteractive', '-Command', opts.command] : ['-c', opts.command],
    {
      cwd: opts.cwd,
      // stdin is closed: a background command must never wait on a prompt no
      // one can answer.
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWin,
      windowsHide: true
    }
  );

  const record = jobs.register({
    kind: 'shell',
    label: opts.command.length > 120 ? `${opts.command.slice(0, 117)}...` : opts.command,
    conversationId: opts.conversationId,
    cwd: opts.cwd,
    kill: () => killTree(child.pid, isWin)
  });

  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');
  child.stdout?.on('data', (d: string) => jobs.append(record.id, d));
  child.stderr?.on('data', (d: string) => jobs.append(record.id, d));
  child.on('error', (err) => {
    jobs.append(record.id, `\n[spawn error] ${err.message}\n`);
    jobs.finish(record.id, { status: 'failed' });
  });
  child.on('close', (code, signal) => {
    jobs.finish(record.id, {
      status: signal ? 'killed' : 'exited',
      exitCode: code,
      signal: signal ?? null
    });
  });

  return record;
}

function killTree(pid: number | undefined, isWin: boolean): void {
  if (!pid) return;
  if (isWin) {
    // /T kills the tree, /F forces it. Detached so a failure here cannot block.
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  // Negative pid targets the whole process group created by detached: true.
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
  const hard = setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 5_000);
  hard.unref();
}
