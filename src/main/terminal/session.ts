import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { logger } from '../utils/logger';
import { resolveWithinAllowed, getWorkspaceRoot } from '../utils/pathPolicy';

const IS_WIN = process.platform === 'win32';

function shellEscapePath(p: string): string {
  if (IS_WIN) {
    // PowerShell single-quoted strings: double embedded single quotes.
    return p.replace(/'/g, "''");
  }
  // Bash single-quoted strings: end quote, escaped quote, resume quote.
  return p.replace(/'/g, "'\\\\''");
}

export function validateTerminalCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return cwd;
  try {
    return resolveWithinAllowed(cwd);
  } catch {
    throw new Error(`Terminal cwd outside workspace: ${cwd}`);
  }
}


export interface ExecResult {
  stdout: string;
  stderr: string;
  cwd: string;
  code: number;
  timedOut?: boolean;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

// A warm, persistent shell process. Commands are piped to its stdin and framed
// with a random sentinel so we can capture per-command output, exit code and
// the working directory — without paying shell-startup cost on every command.
class ShellSession {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuf = '';
  private stderrBuf = '';
  private current: { sentinel: string; resolve: (r: ExecResult) => void } | null = null;
  private queue: Array<() => void> = [];
  private busy = false;
  lastCwd: string;

  constructor(public readonly initialCwd: string) {
    this.lastCwd = initialCwd;
  }

  private ensureProc(): void {
    if (this.proc && this.proc.exitCode === null) return;
    const cwd = this.lastCwd || this.initialCwd || undefined;
    if (IS_WIN) {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', '-'], {
        cwd, windowsHide: true
      }) as ChildProcessWithoutNullStreams;
    } else {
      this.proc = spawn('/bin/sh', ['-i'], { cwd }) as ChildProcessWithoutNullStreams;
    }
    this.stdoutBuf = '';
    this.stderrBuf = '';
    this.proc.stdout.on('data', (d: Buffer) => this.onStdout(d.toString()));
    this.proc.stderr.on('data', (d: Buffer) => { this.stderrBuf += d.toString(); });
    this.proc.on('exit', () => { this.proc = null; });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    if (!this.current) return;
    const idx = this.stdoutBuf.indexOf(this.current.sentinel);
    if (idx < 0) return;
    const before = this.stdoutBuf.slice(0, idx);
    const after = this.stdoutBuf.slice(idx + this.current.sentinel.length);
    const line = after.split('\n')[0] || '';
    const [codeStr, ...cwdParts] = line.split('|');
    const cwd = cwdParts.join('|').replace(/\r/g, '').trim();
    const code = parseInt((codeStr || '').replace(/\r/g, '').trim(), 10);
    if (cwd) this.lastCwd = cwd;
    const resolve = this.current.resolve;
    const stdout = stripAnsi(before).replace(/\r/g, '').replace(/\n+$/, '');
    const stderr = stripAnsi(this.stderrBuf).replace(/\r/g, '').replace(/\n+$/, '');
    this.current = null;
    this.stdoutBuf = '';
    this.stderrBuf = '';
    resolve({ stdout, stderr, cwd: this.lastCwd, code: Number.isNaN(code) ? 0 : code });
    this.busy = false;
    const next = this.queue.shift();
    if (next) next();
  }

  exec(cmd: string, desiredCwd: string | undefined, timeoutMs = 120_000): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
      const task = (): void => {
        this.busy = true;
        this.ensureProc();
        if (!this.proc) { resolve({ stdout: '', stderr: 'Shell unavailable', cwd: this.lastCwd, code: 1 }); this.busy = false; return; }

        // Keep the shell's directory in sync with the explorer folder.
        let prefix = '';
        if (desiredCwd && desiredCwd !== this.lastCwd) {
          const escaped = shellEscapePath(desiredCwd);
          prefix = IS_WIN
            ? `Set-Location -LiteralPath '${escaped}'; `
            : `cd '${escaped}'; `;
          this.lastCwd = desiredCwd;
        }

        const sentinel = `##HIVE${Math.random().toString(36).slice(2)}##`;
        this.current = { sentinel, resolve };

        let settled = false;
        const wrapResolve = this.current.resolve;
        this.current.resolve = (r) => { settled = true; wrapResolve(r); };

        if (IS_WIN) {
          this.proc.stdin.write(`${prefix}${cmd}\n`);
          this.proc.stdin.write(`\n`);
          this.proc.stdin.write(`Write-Output "${sentinel}$($LASTEXITCODE)|$($PWD.Path)"\n`);
        } else {
          this.proc.stdin.write(`${prefix}${cmd}\n`);
          this.proc.stdin.write(`\n`);
          this.proc.stdin.write(`printf "%s%s|%s\\n" "${sentinel}" "$?" "$(pwd)"\n`);
        }

        // If a command hangs (interactive/long-running), recycle the shell so
        // the terminal stays usable, preserving the last known directory.
        setTimeout(() => {
          if (settled || this.current?.sentinel !== sentinel) return;
          this.current = null;
          this.busy = false;
          try { this.proc?.kill(); } catch { /* ignore */ }
          this.proc = null;
          resolve({ stdout: stripAnsi(this.stdoutBuf).replace(/\r/g, ''), stderr: '[command timed out — shell reset]', cwd: this.lastCwd, code: 124, timedOut: true });
          const next = this.queue.shift();
          if (next) next();
        }, timeoutMs);
      };

      if (this.busy) this.queue.push(task);
      else task();
    });
  }

  dispose(): void {
    try { this.proc?.stdin.end(); } catch { /* ignore */ }
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.proc = null;
  }
}

const sessions = new Map<string, ShellSession>();

export function terminalExec(sessionId: string, cmd: string, cwd?: string): Promise<ExecResult> {
  let s = sessions.get(sessionId);
  const validatedCwd = validateTerminalCwd(cwd);
  if (!s) {
    s = new ShellSession(validatedCwd || getWorkspaceRoot());
    sessions.set(sessionId, s);
    logger.info('terminal', `session started (${sessionId})`);
  }
  return s.exec(cmd, validatedCwd);
}

export function terminalDispose(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) { s.dispose(); sessions.delete(sessionId); }
}

export function terminalDisposeAll(): void {
  for (const s of sessions.values()) s.dispose();
  sessions.clear();
}
