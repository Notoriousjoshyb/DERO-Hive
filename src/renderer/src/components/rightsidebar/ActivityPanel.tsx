import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app';
import { diffLines, collapseContext, type DiffLine } from '@shared/diff';
import type { FileCheckpoint } from '@shared/types';
import type { FileChange } from '../../stores/app';
import { ipcErrorMessage } from '../../lib/ipcError';

/**
 * Live terminal-style activity log.
 *
 * Mirrors the look of `git diff` / claude-code's tool output: file path
 * headers with summary stats, then a hunk-by-hunk unified diff with line
 * numbers and colored + / - / context markers. New edits stream in as the
 * agent makes them and the panel auto-scrolls to the latest change.
 */
export function ActivityPanel(): JSX.Element {
  const fileChanges = useAppStore((s) => s.fileChanges);
  const clearFileChanges = useAppStore((s) => s.clearFileChanges);
  const settings = useAppStore((s) => s.settings);
  const currentConversationId = useAppStore((s) => s.currentConversationId);
  const cwd = settings.workingDirectory;

  // Checkpoints for the active conversation, joined to fileChanges by id for
  // the revert button and its reverted state. Refetched whenever a new change
  // streams in so fresh checkpoints join without a manual refresh.
  const [checkpoints, setCheckpoints] = useState<FileCheckpoint[]>([]);
  const [busyCheckpointId, setBusyCheckpointId] = useState<string | null>(null);
  const [revertingAll, setRevertingAll] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const refreshCheckpoints = useCallback(async (): Promise<void> => {
    if (!currentConversationId) {
      setCheckpoints([]);
      return;
    }
    try {
      const list = await window.hive.checkpointList(currentConversationId);
      // A conversation switch mid-flight must not apply the old conversation's list.
      if (useAppStore.getState().currentConversationId === currentConversationId) {
        setCheckpoints(list);
      }
    } catch {
      // Non-fatal: revert buttons simply stay hidden until the next refresh.
    }
  }, [currentConversationId]);

  // fileChanges.length is a deliberate dep: a newly streamed change means a
  // fresh checkpoint may exist, so re-join.
  const lastConversationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastConversationRef.current !== currentConversationId) {
      lastConversationRef.current = currentConversationId;
      // Don't show the previous conversation's checkpoints/errors while the
      // new conversation's list loads.
      setCheckpoints([]);
      setRevertError(null);
    }
    void refreshCheckpoints();
  }, [refreshCheckpoints, fileChanges.length, currentConversationId]);

  const checkpointById = useMemo(() => new Map(checkpoints.map((c) => [c.id, c])), [checkpoints]);
  const unrevertedCount = useMemo(() => checkpoints.filter((c) => !c.revertedAt).length, [checkpoints]);

  const handleRevert = async (change: FileChange): Promise<void> => {
    const checkpointId = change.checkpointId;
    if (!checkpointId || busyCheckpointId || revertingAll) return;
    const isNew = change.isNewFile || !checkpointById.get(checkpointId)?.beforeHash;
    const warning = isNew
      ? `Revert "${change.path}"? The agent created this file — reverting deletes it from disk. This cannot be undone.`
      : `Revert "${change.path}" to its pre-edit state? This overwrites the current file on disk — any edits made after the agent's change will be lost.`;
    if (!confirm(warning)) return;
    setBusyCheckpointId(checkpointId);
    setRevertError(null);
    try {
      const res = await window.hive.checkpointRevert(checkpointId);
      if (!res.ok) {
        setRevertError(res.error || `Failed to revert ${change.path}.`);
        return;
      }
      await refreshCheckpoints();
    } catch (err) {
      setRevertError(ipcErrorMessage(err));
    } finally {
      setBusyCheckpointId(null);
    }
  };

  const handleRevertAll = async (): Promise<void> => {
    if (!currentConversationId || unrevertedCount === 0 || revertingAll || busyCheckpointId) return;
    const warning = `Revert ${unrevertedCount} checkpoint${unrevertedCount === 1 ? '' : 's'} from this conversation? This overwrites the current files on disk (and deletes agent-created files) — any edits made after the agent's changes will be lost.`;
    if (!confirm(warning)) return;
    setRevertingAll(true);
    setRevertError(null);
    try {
      const res = await window.hive.checkpointRevertAll(currentConversationId);
      const failed = res.failed;
      if (!res.ok) {
        setRevertError(res.error || (failed?.length ? `Could not revert ${failed.length} file${failed.length === 1 ? '' : 's'}.` : 'Revert failed.'));
      }
      await refreshCheckpoints();
    } catch (err) {
      setRevertError(ipcErrorMessage(err));
    } finally {
      setRevertingAll(false);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll to the bottom whenever a new change lands. Only follow if
  // the user is already near the bottom so we don't yank them away from
  // an older change they're reading.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = distance < 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [fileChanges]);

  // Reverse so the latest change is at the top of the list; the auto-scroll
  // effect keeps the viewport pinned to it. (Most terminals show newest at
  // the bottom and stream upward — same idea, just our DOM is column-flow.)
  const reversed = useMemo((): FileChange[] => [...fileChanges].reverse(), [fileChanges]);

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-bg-sidebar/40">
        <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
          {fileChanges.length === 0 ? 'No activity yet' : `${fileChanges.length} change${fileChanges.length === 1 ? '' : 's'}`}
        </div>
        <div className="flex items-center gap-1">
          {unrevertedCount > 0 && (
            <button
              onClick={() => void handleRevertAll()}
              disabled={revertingAll || busyCheckpointId !== null}
              className="text-[10px] text-warn hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev transition disabled:opacity-50"
              title="Restore every file to its pre-edit state (overwrites the files on disk)"
            >
              {revertingAll ? 'Reverting…' : `Revert all (${unrevertedCount})`}
            </button>
          )}
          {fileChanges.length > 0 && (
            <button
              onClick={() => clearFileChanges()}
              className="text-[10px] text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev transition"
              title="Clear the activity log"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {revertError && (
        <div className="px-3 py-1.5 text-[10px] text-danger border-b border-border/60">{revertError}</div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {reversed.length === 0 ? (
          <EmptyState cwd={cwd} />
        ) : (
          <div className="divide-y divide-border/40">
            {reversed.map((change, idx) => (
              <ChangeBlock
                key={`${change.path}:${change.at}:${idx}`}
                change={change}
                cwd={cwd}
                checkpoint={change.checkpointId ? checkpointById.get(change.checkpointId) : undefined}
                reverting={busyCheckpointId === change.checkpointId}
                revertDisabled={busyCheckpointId !== null || revertingAll}
                onRevert={() => void handleRevert(change)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ cwd }: { cwd?: string }): JSX.Element {
  return (
    <div className="p-4 text-fg-subtle">
      <div className="text-fg-muted font-medium mb-1">Watching for changes</div>
      <p className="leading-relaxed">
        When the agent edits files you'll see a unified diff stream here, just like a terminal. Each entry shows the
        file path, +/− line counts, and a hunk-level diff with line numbers.
      </p>
      {!cwd && (
        <p className="mt-2 text-warn/80">
          No working directory is set, so file edits won't show their full path here.
        </p>
      )}
    </div>
  );
}

function ChangeBlock({ change, cwd, checkpoint, reverting, revertDisabled, onRevert }: { change: FileChange; cwd?: string; checkpoint?: FileCheckpoint; reverting: boolean; revertDisabled: boolean; onRevert: () => void }): JSX.Element {
  const displayPath = useMemo(() => relativize(change.path, cwd), [change.path, cwd]);
  const hasSnapshot = change.before !== undefined && change.after !== undefined;
  // Revert is only offered when a checkpoint exists and hasn't been rolled
  // back yet. A checkpointId not yet in the fetched list counts as unreverted.
  const reverted = checkpoint?.revertedAt !== undefined;
  // Build the unified diff once per render. For write_file the diff is over
  // the entire file; for edit_file the tool layer sent us a hunk with a
  // few lines of context, anchored at `hunkStartLine`.
  const lines = useMemo(() => {
    if (!hasSnapshot) return [];
    return collapseContext(
      diffLines(change.before ?? '', change.after ?? '', {
        oldStart: change.hunkStartLine ?? 1,
        newStart: change.hunkStartLine ?? 1
      }),
      3
    );
  }, [hasSnapshot, change.before, change.after, change.hunkStartLine]);

  const truncated = change.beforeTruncated || change.afterTruncated;

  return (
    <article className="px-2 py-2 animate-fade-in">
      <header className="flex items-baseline gap-2 mb-1.5">
        <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-[9px] font-bold flex-shrink-0 ${
          change.kind === 'write' ? 'bg-accent/20 text-accent' : 'bg-warn/20 text-warn'
        }`} title={change.kind === 'write' ? 'write_file' : 'edit_file'}>
          {change.kind === 'write' ? 'W' : 'E'}
        </span>
        <div className="font-mono text-[11px] text-fg truncate flex-1" title={change.path}>
          {displayPath}
        </div>
        <div className="flex-shrink-0 text-[10px] tabular-nums flex items-center gap-1">
          <span className="text-success">+{change.linesAdded}</span>
          <span className="text-fg-subtle">/</span>
          <span className="text-danger">−{change.linesRemoved}</span>
        </div>
        {change.checkpointId && (reverted ? (
          <span className="flex-shrink-0 text-[10px] text-fg-subtle/70 italic" title="This edit was reverted to its pre-edit state">reverted</span>
        ) : (
          <button
            onClick={onRevert}
            disabled={revertDisabled}
            className="flex-shrink-0 text-[10px] text-warn hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-elev transition disabled:opacity-50"
            title="Restore this file to its pre-edit state (overwrites the file on disk)"
          >
            {reverting ? 'Reverting…' : 'Revert'}
          </button>
        ))}
      </header>
      {change.isNewFile && (
        <div className="text-[10px] text-accent/80 font-mono pl-5 mb-1">new file</div>
      )}
      <div className="text-[10px] text-fg-subtle/70 font-mono pl-5 mb-1">{formatTime(change.at)}</div>
      {hasSnapshot && lines.length > 0 ? (
        <DiffBlock lines={lines} />
      ) : change.kind === 'edit' ? (
        <div className="pl-5 text-[10px] text-fg-subtle/70 italic">
          (no snapshot available for this edit — see the assistant message for details)
        </div>
      ) : null}
      {truncated && (
        <div className="pl-5 mt-1 text-[10px] text-warn/80 font-mono">
          ⚠ diff truncated — file is larger than the 50KB snapshot limit
        </div>
      )}
    </article>
  );
}

function DiffBlock({ lines }: { lines: DiffLine[] }): JSX.Element {
  return (
    <pre className="m-0 pl-5 font-mono text-[10.5px] leading-snug overflow-x-auto bg-bg-code/40 border border-border/40 rounded-md">
      <code>
        {lines.map((line, idx) => (
          <DiffRow key={idx} line={line} />
        ))}
      </code>
    </pre>
  );
}

function DiffRow({ line }: { line: DiffLine }): JSX.Element {
  if (line.op === 'context' && line.text === '⋮') {
    return <span className="block text-fg-subtle/50 px-1">    ⋮</span>;
  }
  const oldNo = line.oldLineNo !== undefined ? String(line.oldLineNo).padStart(4, ' ') : '    ';
  const newNo = line.newLineNo !== undefined ? String(line.newLineNo).padStart(4, ' ') : '    ';
  const marker = line.op === 'add' ? '+' : line.op === 'del' ? '−' : ' ';
  const colorClass =
    line.op === 'add' ? 'text-success bg-success/[0.06]'
    : line.op === 'del' ? 'text-danger bg-danger/[0.06]'
    : 'text-fg-muted';
  return (
    <span className={`block whitespace-pre ${colorClass} px-1`}>
      <span className="text-fg-subtle/50 select-none tabular-nums">{oldNo} </span>
      <span className="text-fg-subtle/50 select-none tabular-nums">{newNo} </span>
      <span className="select-none w-3 inline-block text-center">{marker}</span>
      <span>{line.text || ' '}</span>
    </span>
  );
}

function relativize(absolute: string, cwd?: string): string {
  if (!cwd) return absolute;
  const normCwd = cwd.replace(/[\\/]+$/, '');
  if (absolute.toLowerCase().startsWith(normCwd.toLowerCase())) {
    const rel = absolute.slice(normCwd.length).replace(/^[\\/]+/, '');
    return rel || absolute;
  }
  return absolute;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}