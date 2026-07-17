import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { terminalExec, terminalDispose } from '../terminal/session';
import { resolveWithinAllowed } from '../utils/pathPolicy';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { redactArgs } from '../utils/redact';

const execAsync = promisify(exec);

function validateCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return cwd;
  try {
    return resolveWithinAllowed(cwd);
  } catch {
    throw new Error(`Shell cwd outside workspace: ${cwd}`);
  }
}

/**
 * Audit trail for the user's own interactive terminal (GAP_ANALYSIS 1D): each
 * executed command lands in tool_executions as tool='terminal_shell'. This is
 * the user's own shell, so there is deliberately no approval prompt and the
 * decision is always 'allow'. Best-effort — audit failures never break exec.
 */
function auditShellRun(cmd: string, durationMs: number, status: 'success' | 'error'): void {
  try {
    getDb().prepare(`
      INSERT INTO tool_executions (id, conversation_id, tool, args_redacted, decision, duration_ms, status, files_touched, created_at)
      VALUES (?, NULL, 'terminal_shell', ?, 'allow', ?, ?, '[]', ?)
    `).run(randomUUID(), redactArgs({ cmd }), durationMs, status, Date.now());
  } catch (err) {
    logger.warn('shell', 'terminal audit write failed', err);
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
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: validateCwd(cwd),
        timeout: timeoutMs || 30000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ...env },
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
      });
      auditShellRun(cmd, Date.now() - startedAt, 'success');
      return { ok: true, stdout: stdout.slice(0, 200_000), stderr: stderr.slice(0, 200_000) };
    } catch (err) {
      auditShellRun(cmd, Date.now() - startedAt, 'error');
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
