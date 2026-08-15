import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Structured git: run git through argv, never through a shell string.
 *
 * The point is not convenience — the model can already spell `git status` into
 * run_shell. It is that a laundered shell string is opaque to the permission
 * layer, the audit log and the UI, while these calls have a name, typed
 * arguments and a parsed result the Git panel and the agent can both read.
 *
 * See REMAINING_WORK.md §3.3.
 */

export interface GitRun {
  stdout: string;
  stderr: string;
  code: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Reject a value that git would read as an option. With argv there is no shell
 * to escape, but a ref or path beginning with `-` is still parsed as a flag,
 * which is how a benign-looking argument turns into `--upload-pack=...`.
 */
export function assertSafeArg(kind: string, value: string): void {
  if (value.startsWith('-')) throw new Error(`Invalid ${kind}: must not start with "-" (${value}).`);
}

export async function runGit(args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GitRun> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      windowsHide: true
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    // ENOENT means git itself is missing — worth saying plainly rather than
    // reporting it as a failed git command.
    if (e.code === 'ENOENT') throw new Error('git is not installed or not on PATH.', { cause: err });
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || e.message || '',
      code: typeof e.code === 'number' ? e.code : 1
    };
  }
}

/** True when `cwd` is inside a git work tree. */
export async function isRepo(cwd: string): Promise<boolean> {
  const r = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export interface GitStatusEntry {
  /** Two-character porcelain code, e.g. " M", "A ", "??". */
  code: string;
  path: string;
  /** Rename/copy destination, when git reported one. */
  renamedFrom?: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
  clean: boolean;
}

/**
 * Parse `git status --porcelain=v1 -b -z` output. NUL-delimited so paths with
 * spaces, quotes or newlines survive — the space-delimited form silently
 * mangles them.
 */
export function parseStatus(out: string): GitStatus {
  const records = out.split('\0').filter((r) => r.length > 0);
  const status: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, entries: [], clean: true };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.startsWith('## ')) {
      const header = rec.slice(3);
      const trackMatch = header.match(/^(.+?)(?:\.\.\.(\S+))?(?:\s\[(.+)\])?$/);
      if (trackMatch) {
        status.branch = trackMatch[1] === 'HEAD (no branch)' ? null : trackMatch[1];
        status.upstream = trackMatch[2] ?? null;
        const track = trackMatch[3] || '';
        status.ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0);
        status.behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0);
      }
      continue;
    }
    const code = rec.slice(0, 2);
    let path = rec.slice(3);
    let renamedFrom: string | undefined;
    // A rename or copy emits the destination in this record and the source in
    // the next one.
    if (code[0] === 'R' || code[0] === 'C') {
      renamedFrom = records[++i];
    }
    if (!path) continue;
    path = path.trim();
    status.entries.push({
      code,
      path,
      renamedFrom,
      staged: code[0] !== ' ' && code[0] !== '?',
      unstaged: code[1] !== ' ' && code[1] !== '?',
      untracked: code === '??'
    });
  }

  status.clean = status.entries.length === 0;
  return status;
}

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

/** Field separator for log parsing: a unit separator cannot occur in a subject. */
export const LOG_FORMAT = '%H%x1f%an%x1f%aI%x1f%s';

export function parseLog(out: string): GitCommitEntry[] {
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = '', author = '', date = '', ...rest] = line.split('\x1f');
      return { hash, shortHash: hash.slice(0, 8), author, date, subject: rest.join('\x1f') };
    })
    .filter((c) => c.hash);
}

/** Render a status for the model: short, grouped, and countable. */
export function formatStatus(status: GitStatus): string {
  const head = status.branch
    ? `On branch ${status.branch}${status.upstream ? ` (tracking ${status.upstream})` : ''}`
    : 'Detached HEAD';
  const track = status.ahead || status.behind
    ? `\n${status.ahead} ahead, ${status.behind} behind`
    : '';
  if (status.clean) return `${head}${track}\nWorking tree clean`;

  const staged = status.entries.filter((e) => e.staged);
  const unstaged = status.entries.filter((e) => e.unstaged && !e.untracked);
  const untracked = status.entries.filter((e) => e.untracked);
  const section = (title: string, entries: GitStatusEntry[]): string =>
    entries.length ? `\n\n${title} (${entries.length}):\n${entries.map((e) => `  ${e.code} ${e.renamedFrom ? `${e.renamedFrom} -> ` : ''}${e.path}`).join('\n')}` : '';

  return `${head}${track}${section('Staged', staged)}${section('Not staged', unstaged)}${section('Untracked', untracked)}`;
}
