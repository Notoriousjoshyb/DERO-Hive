import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * ripgrep-backed file discovery and search.
 *
 * The previous JS implementation globbed `**\/*` and read every matching file
 * into memory to regex it line by line — on a real repo that means reading
 * lockfiles, images and minified bundles to find a symbol. ripgrep skips
 * binaries, honours .gitignore, and searches in parallel.
 *
 * Borrowed from the DeepSeek Harness approach of shipping the binary rather
 * than depending on a host install (HARNESS_INTEGRATION_PLAN.md item 3).
 * `@vscode/ripgrep` has no postinstall — the binaries arrive as
 * platform-specific optional dependencies — so an `--ignore-scripts` install
 * still gets a working one. Callers must still handle its absence: optional
 * deps are skipped entirely on unsupported platforms and by `--no-optional`.
 */

export const DEFAULT_IGNORES = ['node_modules', '.git', 'dist', 'out'];

let cachedPath: string | null | undefined;

/** Absolute path to the bundled rg, or null when this platform has no build. */
export function ripgrepPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    cachedPath = rgPath && existsSync(rgPath) ? rgPath : null;
  } catch {
    cachedPath = null;
  }
  return cachedPath;
}

interface RunResult {
  stdout: string;
  /** rg's exit code: 0 = matches, 1 = no matches, 2 = error. */
  code: number;
  stderr: string;
}

/**
 * Run rg with an argv array — never a shell string. The pattern comes from the
 * model, so it must never reach a shell for interpretation.
 */
function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // stdin MUST be closed, not an open pipe: ripgrep searches stdin whenever
    // it is not a TTY, so an inherited pipe makes it block forever instead of
    // walking the directory.
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`ripgrep timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 2 });
    });
  });
}

function ignoreArgs(ignore: string[] | undefined): string[] {
  const globs = ignore?.length ? ignore : DEFAULT_IGNORES;
  // `!` excludes. A caller-supplied bare directory name is turned into a
  // recursive exclude so "node_modules" behaves the way people expect.
  return globs.flatMap((g) => ['--glob', `!${g.includes('/') || g.includes('*') ? g : `**/${g}/**`}`]);
}

/** List files matching a glob. Returns null when rg is unavailable. */
export async function rgFiles(
  pattern: string,
  cwd: string,
  ignore: string[] | undefined,
  timeoutMs = 20_000
): Promise<string[] | null> {
  const bin = ripgrepPath();
  if (!bin) return null;
  const args = ['--files', '--hidden', '--glob', pattern, ...ignoreArgs(ignore)];
  const { stdout, code, stderr } = await run(bin, args, cwd, timeoutMs);
  // 1 means "nothing matched", which is a legitimate empty result, not a failure.
  if (code === 2) throw new Error(stderr.trim() || 'ripgrep failed');
  return stdout.split('\n').filter(Boolean).map((p) => p.replace(/\\/g, '/'));
}

export interface RgSearchResult {
  lines: string[];
  /** True when the cap cut the list short. */
  truncated: boolean;
}

/** Search file contents. Returns null when rg is unavailable. */
export async function rgSearch(
  pattern: string,
  cwd: string,
  include: string | undefined,
  ignore: string[] | undefined,
  maxResults: number,
  timeoutMs = 20_000
): Promise<RgSearchResult | null> {
  const bin = ripgrepPath();
  if (!bin) return null;
  const args = [
    '--line-number',
    '--no-heading',
    '--color', 'never',
    '--hidden',
    // Cap per file as well as overall, so one enormous generated file cannot
    // consume the entire result budget.
    '--max-count', String(Math.max(1, Math.min(maxResults, 200))),
    ...(include ? ['--glob', include] : []),
    ...ignoreArgs(ignore),
    '--regexp', pattern,
    '--'
  ];
  const { stdout, code, stderr } = await run(bin, args, cwd, timeoutMs);
  if (code === 2) throw new Error(stderr.trim() || 'ripgrep failed');

  const all = stdout.split('\n').filter(Boolean).map((l) => l.replace(/\\/g, '/'));
  return { lines: all.slice(0, maxResults), truncated: all.length > maxResults };
}
