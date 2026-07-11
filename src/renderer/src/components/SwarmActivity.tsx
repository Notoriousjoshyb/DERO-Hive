import { useMemo, useState } from 'react';
import type { SwarmRun, SwarmTask } from '@shared/types';
import { swarmTaskLabel, swarmTeamSummary } from '@shared/swarm';
import { useAppStore } from '../stores/app';

const ACTIVE = new Set(['queued', 'running', 'verifying', 'synthesizing']);

export function SwarmActivity({ conversationId }: { conversationId?: string }): JSX.Element | null {
  const runs = useAppStore((state) => state.swarmRuns);
  const run = useMemo(() => Object.values(runs)
    .filter((item) => item.conversationId === conversationId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [conversationId, runs]);
  const [openTask, setOpenTask] = useState<SwarmTask | null>(null);
  const [busy, setBusy] = useState(false);

  if (!run) return null;

  const command = async (action: 'abort' | 'resume' | 'apply'): Promise<void> => {
    setBusy(true);
    try {
      const next = action === 'abort'
        ? await window.hive.swarmAbort(run.id)
        : action === 'resume'
          ? await window.hive.swarmResume(run.id)
          : await window.hive.swarmApply(run.id);
      useAppStore.getState().upsertSwarmRun(next);
    } catch (error) {
      useAppStore.getState().setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-xl border border-accent/25 bg-accent-soft/30 p-3 animate-msg-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-white">S</span>
            <span className="text-xs font-medium text-fg">Native swarm</span>
            <Status value={run.status} />
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{run.prompt}</p>
          <p className="mt-1 text-[10px] text-fg-subtle">{run.mode} · {swarmTeamSummary(run.workerCount)}</p>
        </div>
        <div className="flex gap-1">
          {ACTIVE.has(run.status) && <Action label="Abort" disabled={busy} onClick={() => void command('abort')} />}
          {['interrupted', 'failed', 'aborted'].includes(run.status) && <Action label="Resume" disabled={busy} onClick={() => void command('resume')} />}
          {run.status === 'awaiting_apply' && <Action label="Apply" disabled={busy} onClick={() => void command('apply')} primary />}
          {run.status === 'applying' && <Action label="Retry Apply" disabled={busy} onClick={() => void command('apply')} primary />}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {run.tasks.map((task) => (
          <button key={task.id} onClick={() => setOpenTask(task)} className="rounded-lg border border-border bg-bg/80 px-3 py-2 text-left hover:border-accent/50 hover:bg-bg-elev">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-fg">{swarmTaskLabel(task.phase, task.index, run.workerCount)}</span>
              <Status value={task.status} />
            </div>
            <div className="mt-0.5 truncate text-[10px] text-fg-subtle">{task.error || task.output || 'Waiting…'}</div>
          </button>
        ))}
      </div>

      {run.result && (
        <div className="mt-3 rounded-lg border border-border bg-bg/70 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Synthesis</div>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-fg-muted">{run.result}</pre>
        </div>
      )}
      {run.error && <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{run.error}</div>}
      {run.mode === 'build' && run.status === 'awaiting_apply' && (
        <p className="mt-2 text-[10px] text-warn">Changes remain on {run.integrationBranch}. Apply is refused if your branch, HEAD, or working tree changed.</p>
      )}
      {run.mode === 'build' && run.status === 'applying' && (
        <p className="mt-2 text-[10px] text-warn">Apply is incomplete. Retry Apply resumes the persisted operation without moving the branch twice.</p>
      )}

      {openTask && <TaskDetails task={openTask} run={run} onClose={() => setOpenTask(null)} />}
    </section>
  );
}

function Action({ label, onClick, disabled, primary = false }: { label: string; onClick: () => void; disabled: boolean; primary?: boolean }): JSX.Element {
  return <button onClick={onClick} disabled={disabled} className={`rounded px-2 py-1 text-[10px] disabled:opacity-40 ${primary ? 'bg-accent text-white' : 'border border-border bg-bg text-fg-muted hover:text-fg'}`}>{label}</button>;
}

function Status({ value }: { value: string }): JSX.Element {
  const color = value === 'completed' || value === 'applied' || value === 'awaiting_apply'
    ? 'text-success' : value === 'failed' || value === 'aborted' ? 'text-danger' : 'text-accent';
  return <span className={`text-[9px] ${color}`}>{value.replace('_', ' ')}</span>;
}

function TaskDetails({ task, run, onClose }: { task: SwarmTask; run: SwarmRun; onClose: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elev shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div><h3 className="text-sm font-semibold text-fg">{swarmTaskLabel(task.phase, task.index, run.workerCount)}</h3><p className="mt-0.5 text-[10px] text-fg-subtle">{task.branchName || run.mode}</p></div>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-bg-input hover:text-fg" aria-label="Close">×</button>
        </div>
        <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-4 font-sans text-xs leading-relaxed text-fg-muted">{task.error || task.output || 'No output yet.'}</pre>
      </div>
    </div>
  );
}
