import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { terminalExec, terminalDispose } from '../terminal/session';
import { resolveAndValidate, getWorkspaceRoot } from '../utils/pathPolicy';

const execAsync = promisify(exec);

function validateCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return cwd;
  try {
    return resolveAndValidate(cwd, getWorkspaceRoot());
  } catch {
    throw new Error(`Shell cwd outside workspace: ${cwd}`);
  }
}

export function registerShellHandlers(): void {
  // Persistent, warm shell session for the Code tab terminal (fast — no
  // per-command process startup).
  ipcMain.handle(IPC.TERMINAL_EXEC, async (_e, { sessionId, cmd, cwd }: { sessionId: string; cmd: string; cwd?: string }) => {
    return terminalExec(sessionId, cmd, validateCwd(cwd));
  });
  ipcMain.handle(IPC.TERMINAL_DISPOSE, (_e, sessionId: string) => {
    terminalDispose(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.SHELL_RUN, async (_e, { cmd, cwd, timeoutMs, env }: { cmd: string; cwd?: string; timeoutMs?: number; env?: Record<string, string> }) => {
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: validateCwd(cwd),
        timeout: timeoutMs || 30000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ...env },
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
      });
      return { ok: true, stdout: stdout.slice(0, 200_000), stderr: stderr.slice(0, 200_000) };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        ok: false,
        code: e.code,
        stdout: (e.stdout || '').slice(0, 200_000),
        stderr: (e.stderr || '').slice(0, 200_000),
        error: e.message
      };
    }
  });
}
