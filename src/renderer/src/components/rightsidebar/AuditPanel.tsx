import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app';
import { ipcErrorMessage } from '../../lib/ipcError';
import type { ToolExecutionRecord } from '@shared/types';

const PAGE_SIZE = 50;

/**
 * Tool-execution audit log (Phase 1D). Reads the persisted tool_executions
 * table via `window.hive.auditList` — newest first, paged, with an optional
 * filter to the active conversation. Rows expand to show the redacted args
 * and the files each call touched.
 */
export function AuditPanel(): JSX.Element {
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const [records, setRecords] = useState<ToolExecutionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [currentOnly, setCurrentOnly] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Bumped per load so a slower earlier request (e.g. from the conversation
  // we just switched away from) can't apply its rows over a newer one.
  const loadSeq = useRef(0);

  const load = useCallback(async (offset: number, append: boolean): Promise<void> => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await window.hive.auditList({
        conversationId: currentOnly ? currentConversationId || undefined : undefined,
        limit: PAGE_SIZE,
        offset
      });
      if (seq !== loadSeq.current) return;
      setRecords((prev) => (append ? [...prev, ...page] : page));
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(ipcErrorMessage(err));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [currentOnly, currentConversationId]);

  // Reload from the top whenever the filter or the active conversation changes.
  useEffect(() => {
    setExpandedId(null);
    void load(0, false);
  }, [load]);

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-bg-sidebar/40">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          {records.length === 0 && !loading ? 'No tool executions' : `${records.length} execution${records.length === 1 ? '' : 's'}`}
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-fg-subtle cursor-pointer select-none">
          <input
            type="checkbox"
            checked={currentOnly}
            onChange={(e) => setCurrentOnly(e.target.checked)}
            className="accent-accent"
          />
          This conversation
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {records.length === 0 && !loading && !error ? (
          <div className="p-4 text-fg-subtle">
            <div className="text-fg-muted font-medium mb-1">Nothing audited yet</div>
            <p className="leading-relaxed">
              Every tool the agent runs is recorded here with its approval decision, duration, and the files it
              touched.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {records.map((rec) => (
              <AuditRow
                key={rec.id}
                record={rec}
                expanded={expandedId === rec.id}
                onToggle={() => setExpandedId((cur) => (cur === rec.id ? null : rec.id))}
              />
            ))}
          </div>
        )}
        {error && <div className="px-3 py-2 text-[11px] text-danger">{error}</div>}
        {hasMore && !error && (
          <button
            onClick={() => void load(records.length, true)}
            disabled={loading}
            className="w-full px-3 py-2 text-[11px] text-fg-subtle hover:text-fg hover:bg-bg-elev transition disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {loading && records.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-fg-subtle">Loading…</div>
        )}
      </div>
    </div>
  );
}

function AuditRow({ record, expanded, onToggle }: { record: ToolExecutionRecord; expanded: boolean; onToggle: () => void }): JSX.Element {
  // Deny is the loudest signal, then errors; success/allow stays neutral.
  const tone: 'denied' | 'error' | 'ok' =
    record.status === 'denied' || record.decision === 'deny' ? 'denied'
    : record.status === 'error' ? 'error'
    : 'ok';
  const toneClass = tone === 'denied' ? 'text-danger' : tone === 'error' ? 'text-warn' : 'text-fg-muted';
  const statusLabel = record.status === 'denied' ? 'denied' : record.status;

  return (
    <article className="px-2 py-1.5">
      <button onClick={onToggle} className="w-full flex items-center gap-2 text-left rounded hover:bg-bg-elev/60 px-1 py-0.5 transition">
        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${tone === 'denied' ? 'bg-danger' : tone === 'error' ? 'bg-warn' : 'bg-fg-subtle/60'}`} title={`${statusLabel} · ${record.decision}`} />
        <span className="font-mono text-[11px] text-fg truncate flex-1" title={record.tool}>{record.tool}</span>
        <span className={`flex-shrink-0 text-[10px] ${toneClass}`}>{statusLabel}</span>
        <span className="flex-shrink-0 text-[10px] text-fg-subtle tabular-nums">{formatDuration(record.durationMs)}</span>
        <span className="flex-shrink-0 text-[10px] text-fg-subtle/70">{relativeTime(record.createdAt)}</span>
      </button>
      {expanded && (
        <div className="pl-5 pr-1 pt-1 pb-1.5 space-y-1.5 animate-fade-in">
          <div className="flex items-center gap-2 text-[10px] text-fg-subtle">
            <span>decision: <span className={toneClass}>{record.decision}</span></span>
            <span>{new Date(record.createdAt).toLocaleString()}</span>
          </div>
          <pre className="m-0 font-mono text-[10.5px] leading-snug overflow-x-auto bg-bg-code/40 border border-border/40 rounded-md p-1.5 whitespace-pre-wrap break-all">
            {prettyJson(record.argsRedacted)}
          </pre>
          {record.filesTouched.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-0.5">Files touched</div>
              <ul className="space-y-0.5">
                {record.filesTouched.map((f) => (
                  <li key={f} className="font-mono text-[10.5px] text-fg-muted truncate" title={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
