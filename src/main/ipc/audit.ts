import { ipcMain } from 'electron';
import { IPC, type ToolExecutionRecord } from '@shared/types';
import { getDb } from '../db/client';

export interface AuditListFilter {
  conversationId?: string;
  limit?: number;
  offset?: number;
}

// Tool-execution audit log. Rows are written by the tool registry / shell
// handlers; this is the paged read side for the renderer's Audit tab.
export function registerAuditHandlers(): void {
  ipcMain.handle(IPC.AUDIT_LIST, (_e, filter?: AuditListFilter) => {
    const limit = clampInt(filter?.limit, 50, 1, 200);
    const offset = clampInt(filter?.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const rows = (filter?.conversationId
      ? getDb().prepare('SELECT * FROM tool_executions WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(filter.conversationId, limit, offset)
      : getDb().prepare('SELECT * FROM tool_executions ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(limit, offset)) as Array<Record<string, unknown>>;
    return rows.map(rowToToolExecution);
  });
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function rowToToolExecution(row: Record<string, unknown>): ToolExecutionRecord {
  return {
    id: row.id as string,
    conversationId: (row.conversation_id as string) || '',
    tool: row.tool as string,
    argsRedacted: (row.args_redacted as string) || '',
    decision: row.decision as ToolExecutionRecord['decision'],
    durationMs: (row.duration_ms as number) ?? 0,
    status: row.status as ToolExecutionRecord['status'],
    filesTouched: parseFilesTouched(row.files_touched),
    createdAt: row.created_at as number
  };
}

function parseFilesTouched(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
