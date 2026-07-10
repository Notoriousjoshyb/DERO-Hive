import { useState } from 'react';
import { useAppStore, type SwarmWorkerActivity } from '../stores/app';

export function SwarmActivity({ conversationId }: { conversationId?: string }): JSX.Element | null {
  const run = useAppStore((s) => conversationId ? s.swarmRuns[conversationId] : undefined);
  const [openWorker, setOpenWorker] = useState<SwarmWorkerActivity | null>(null);

  if (!run) return null;

  return (
    <section className="mb-4 rounded-xl border border-accent/25 bg-accent-soft/30 p-3 animate-msg-in">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-white">S</span>
        <div className="text-xs font-medium text-fg">Swarm task</div>
        <span className="text-[10px] text-fg-subtle">{run.workers.length} specialists</span>
      </div>
      <p className="mb-3 line-clamp-2 text-xs text-fg-muted">{run.task}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {run.workers.map((worker) => (
          <button
            key={worker.agentId}
            onClick={() => setOpenWorker(worker)}
            className="rounded-lg border border-border bg-bg/80 px-3 py-2 text-left transition hover:border-accent/50 hover:bg-bg-elev"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-fg">{worker.agentName}</span>
              <span className={`text-[10px] ${worker.error ? 'text-danger' : 'text-success'}`}>{worker.error ? 'failed' : 'completed'}</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-fg-subtle">{worker.task}</div>
          </button>
        ))}
      </div>

      {openWorker && <WorkerDialogue worker={openWorker} onClose={() => setOpenWorker(null)} />}
    </section>
  );
}

function WorkerDialogue({ worker, onClose }: { worker: SwarmWorkerActivity; onClose: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elev shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">{worker.agentName}</h3>
            <p className="mt-0.5 text-xs text-fg-subtle">Task: {worker.task}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-bg-input hover:text-fg" aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {worker.error && <div className="rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{worker.error}</div>}
          {worker.dialogue.length === 0 ? (
            <p className="text-xs text-fg-subtle">No worker dialogue was returned.</p>
          ) : worker.dialogue.map((message) => (
            <article key={message.id} className={`rounded-lg border p-3 ${message.role === 'assistant' ? 'border-accent/20 bg-accent-soft/20' : 'border-border bg-bg'}`}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{message.role}</div>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-fg-muted">{contentText(message.content)}</pre>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function contentText(content: SwarmWorkerActivity['dialogue'][number]['content']): string {
  return typeof content === 'string'
    ? content
    : content.map((part) => part.type === 'text' ? part.text : `[${part.type}]`).join('\n');
}
