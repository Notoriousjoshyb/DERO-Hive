import { useEffect, useRef, useState } from 'react';
import { diffLines, collapseContext, diffCounts, type DiffLine } from '@shared/diff';
import { useAppStore } from '../stores/app';

/**
 * The approval gate.
 *
 * Two things it now does that it did not: it says **which conversation** is
 * asking (with several running, "allow this tool call?" on its own is not a
 * question anyone can answer), and for a write or an edit it renders the actual
 * diff instead of the raw JSON arguments. A wall of escaped JSON is not a
 * decision aid — the diff is the thing being approved.
 *
 * See REMAINING_WORK.md §2.3 and §5.5.
 */
export function PermissionDialog(): JSX.Element | null {
  const pending = useAppStore((s) => s.pendingPermissions);
  const remove = useAppStore((s) => s.removePendingPermission);
  const conversations = useAppStore((s) => s.conversations);
  const dialogRef = useRef<HTMLDivElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);

  const req = pending[0];

  useEffect(() => {
    if (req) requestAnimationFrame(() => denyRef.current?.focus());
  }, [req?.requestId]);

  if (!req) return null;

  const decide = async (decision: 'allow' | 'deny'): Promise<void> => {
    await window.hive.toolPermissionDecide({ requestId: req.requestId, decision });
    remove(req.requestId);
  };

  const askingTitle = conversations.find((c) => c.id === req.conversationId)?.title;
  const args = (req.args ?? {}) as Record<string, unknown>;
  const isFileChange = req.toolName === 'write_file' || req.toolName === 'edit_file';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center px-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Approve ${req.toolName}`}
      onKeyDown={(e) => {
        // Escape denies. Dismissing a permission prompt must never be the
        // permissive outcome.
        if (e.key === 'Escape') { e.stopPropagation(); void decide('deny'); }
      }}
      ref={dialogRef}
    >
      <div className="bg-bg-elev border border-border rounded-2xl shadow-elev-lg max-w-2xl w-full p-5 animate-slide-up">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-warn/15 flex items-center justify-center text-warn flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2z" strokeLinejoin="round" />
              <path d="M8 6v2.5M8 10.5v.01" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-fg">Allow this tool call?</h3>
            <p className="text-xs text-fg-muted mt-0.5">
              <span className="font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded-md">{req.toolName}</span>
              {askingTitle && <> · asked by <span className="text-fg">{askingTitle}</span></>}
            </p>
          </div>
          {pending.length > 1 && (
            <span className="text-[11px] text-fg-subtle bg-bg-input border border-border rounded-full px-2 py-0.5 flex-shrink-0">
              1 of {pending.length}
            </span>
          )}
        </div>

        {req.description && (
          <p className="text-sm text-fg-muted mb-3 leading-relaxed">{req.description}</p>
        )}

        {isFileChange
          ? <ChangePreview toolName={req.toolName} args={args} />
          : (
            <pre className="bg-bg-code border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 mb-4 text-fg-muted leading-relaxed">
              <code>{JSON.stringify(req.args, null, 2)}</code>
            </pre>
          )}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
          <button
            ref={denyRef}
            onClick={() => void decide('deny')}
            className="px-4 py-1.5 rounded-lg border border-border bg-bg hover:bg-bg-input hover:border-border-strong text-fg text-sm transition"
          >
            Deny
          </button>
          <button
            onClick={() => void decide('allow')}
            className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

interface Hunk { label: string; lines: DiffLine[] }

/**
 * What the call would actually do to the file.
 *
 * `write_file` is diffed against the file on disk, so an overwrite shows what
 * is being lost. `edit_file` is diffed hunk by hunk from its own arguments —
 * no file read needed, and it matches how the model expressed the change.
 */
function ChangePreview({ toolName, args }: { toolName: string; args: Record<string, unknown> }): JSX.Element {
  const path = typeof args.path === 'string' ? args.path : '';
  const [hunks, setHunks] = useState<Hunk[] | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function build(): Promise<void> {
      if (toolName === 'edit_file') {
        const edits = readEdits(args);
        if (edits.length === 0) { setNote('No edits in this call.'); setHunks([]); return; }
        setNote(edits.length > 1 ? `${edits.length} edits, applied together or not at all` : '');
        setHunks(edits.map((e, i) => ({
          label: edits.length > 1 ? `Edit ${i + 1}` : '',
          lines: collapseContext(diffLines(e.oldText, e.newText), 3)
        })));
        return;
      }

      const content = typeof args.content === 'string' ? args.content : '';
      let previous = '';
      let existed = false;
      let partial = false;
      try {
        const res = await window.hive.fsRead(path) as { content?: string; truncated?: boolean } | string | null;
        const text = typeof res === 'string' ? res : res?.content;
        if (typeof text === 'string') { previous = text; existed = true; }
        // A truncated read would diff the tail of the old file against nothing
        // and read as a huge deletion, so say the preview is partial.
        partial = typeof res === 'object' && res !== null && res.truncated === true;
      } catch {
        // Unreadable or absent: treat as a new file and say so, rather than
        // showing a diff that pretends to know the old content.
      }
      if (cancelled) return;
      const lines = collapseContext(diffLines(previous, content), 3);
      const counts = diffCounts(lines);
      setNote([
        existed ? `Overwrites the existing file · +${counts.added} −${counts.removed}` : `Creates a new file · ${content.split('\n').length} lines`,
        partial ? '· preview partial, the file is too large to read in full' : ''
      ].filter(Boolean).join(' '));
      setHunks([{ label: '', lines }]);
    }
    void build();
    return () => { cancelled = true; };
  }, [toolName, path, JSON.stringify(args)]);

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="font-mono text-xs text-fg truncate">{path || '(no path)'}</span>
        {note && <span className="text-[11px] text-fg-subtle flex-shrink-0">{note}</span>}
      </div>
      {hunks === null && <div className="text-xs text-fg-subtle">Reading the file…</div>}
      {hunks?.map((hunk, i) => (
        <div key={i} className="mb-2">
          {hunk.label && <div className="text-[11px] text-fg-subtle mb-0.5">{hunk.label}</div>}
          <pre className="m-0 font-mono text-[11px] leading-snug overflow-auto max-h-64 bg-bg-code border border-border rounded-lg">
            <code>
              {hunk.lines.map((line, idx) => <DiffRow key={idx} line={line} />)}
            </code>
          </pre>
        </div>
      ))}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }): JSX.Element {
  if (line.op === 'context' && line.text === '⋮') {
    return <span className="block text-fg-subtle/50 px-2">⋮</span>;
  }
  const marker = line.op === 'add' ? '+' : line.op === 'del' ? '−' : ' ';
  const colorClass =
    line.op === 'add' ? 'text-success bg-success/[0.06]'
    : line.op === 'del' ? 'text-danger bg-danger/[0.06]'
    : 'text-fg-muted';
  return (
    <span className={`block whitespace-pre px-2 ${colorClass}`}>
      <span className="select-none w-3 inline-block text-center">{marker}</span>
      <span>{line.text || ' '}</span>
    </span>
  );
}

/** Read both edit_file argument forms: the `edits` array and the single pair. */
function readEdits(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  if (Array.isArray(args.edits)) {
    return args.edits
      .map((raw) => {
        const e = (raw ?? {}) as Record<string, unknown>;
        return { oldText: String(e.old_text ?? ''), newText: String(e.new_text ?? '') };
      })
      .filter((e) => e.oldText || e.newText);
  }
  if (typeof args.old_text === 'string') {
    return [{ oldText: args.old_text, newText: typeof args.new_text === 'string' ? args.new_text : '' }];
  }
  return [];
}
