import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';

type ContextMode = 'chat' | 'workspace' | 'pinned';

interface ContextNote {
  id: string;
  title: string;
  url: string;
  text: string;
}

const QUICK_ACTIONS = [
  { label: 'Summarize', prompt: 'Summarize the supplied workspace context. Lead with the important facts and decisions.' },
  { label: 'Explain', prompt: 'Explain the supplied workspace context clearly, including any assumptions or gaps.' },
  { label: 'Action items', prompt: 'Turn the supplied workspace context into concise, prioritized action items.' }
];

export function HiveCompanionPanel(): JSX.Element {
  const close = useAppStore((s) => s.toggleCompanion);
  const messages = useAppStore((s) => s.currentMessages);
  const conversation = useAppStore((s) => s.conversations.find((item) => item.id === s.currentConversationId));
  const [mode, setMode] = useState<ContextMode>('workspace');
  const [notes, setNotes] = useState<ContextNote[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', url: '', text: '' });
  const [bridge, setBridge] = useState<{ enabled: boolean; port: number; pairingCode?: string; paired: boolean }>({ enabled: false, port: 43120, paired: false });

  useEffect(() => {
    let active = true;
    void window.hive.browserBridgeSetEnabled(true).then((status) => { if (active) setBridge(status); });
    return () => { active = false; };
  }, []);

  const revokePairing = (): void => {
    void window.hive.browserBridgeRevokePairing().then(setBridge);
  };

  const chatExcerpt = useMemo(() => messages.slice(-4).map((message) => {
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    return `${message.role === 'assistant' ? 'Assistant' : 'You'}: ${content}`;
  }).join('\n\n'), [messages]);

  const context = useMemo(() => {
    const parts: string[] = [];
    if (mode !== 'pinned' && chatExcerpt) parts.push(`Conversation excerpt (recent messages):\n${chatExcerpt}`);
    if (mode !== 'chat' && notes.length) {
      parts.push(`Pinned workspace notes:\n${notes.map((note) => `- ${note.title || 'Untitled note'}${note.url ? ` (${note.url})` : ''}\n${note.text}`).join('\n\n')}`);
    }
    return parts.join('\n\n');
  }, [chatExcerpt, mode, notes]);

  const compose = (instruction: string): void => {
    const receipt = context || 'No extra context is attached.';
    window.dispatchEvent(new CustomEvent<string>('hive:companion-compose', {
      detail: `${instruction}\n\n<context_receipt source="DERO Hive Companion" mode="${mode}">\n${receipt}\n</context_receipt>`
    }));
  };

  const addNote = (): void => {
    if (!draft.title.trim() && !draft.text.trim() && !draft.url.trim()) return;
    setNotes((current) => [...current, { id: crypto.randomUUID(), title: draft.title.trim(), url: draft.url.trim(), text: draft.text.trim() }]);
    setDraft({ title: '', url: '', text: '' });
    setAdding(false);
  };

  const included = mode === 'chat' ? (chatExcerpt ? 1 : 0) : mode === 'pinned' ? notes.length : (chatExcerpt ? 1 : 0) + notes.length;

  return (
    <aside data-hive-companion className="absolute inset-y-0 right-0 z-30 flex w-[min(390px,calc(100vw-24px))] flex-col border-l border-border bg-bg-sidebar shadow-2xl animate-fade-in">
      <header className="flex items-start justify-between border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">H</span>
            <div>
              <h2 className="text-sm font-semibold text-fg">Hive Companion</h2>
              <p className="text-[11px] text-fg-subtle">Scoped context for this chat</p>
            </div>
          </div>
        </div>
        <button onClick={close} className="rounded-md p-1.5 text-fg-subtle hover:bg-bg-elev hover:text-fg" aria-label="Close Hive Companion">×</button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-xl border border-success/30 bg-success/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-fg">Browser Companion bridge</h3>
              <p className="mt-0.5 text-[10px] text-fg-subtle">{bridge.enabled ? (bridge.paired ? 'Extension paired' : 'Waiting for the extension to pair') : 'Starting local-only bridge…'}</p>
            </div>
            <span className={`h-2 w-2 rounded-full ${bridge.enabled ? 'bg-success' : 'bg-warn animate-pulse'}`} />
          </div>
          {bridge.pairingCode && !bridge.paired && (
            <div className="mt-2 rounded-lg border border-border bg-bg/70 p-2">
              <p className="text-[10px] text-fg-subtle">Enter this code in the Browser Companion extension to pair it:</p>
              <p className="mt-1 text-center font-mono text-sm font-semibold tracking-widest text-fg">{bridge.pairingCode}</p>
            </div>
          )}
          {bridge.paired && (
            <button onClick={revokePairing} className="mt-2 text-[10px] font-medium text-danger hover:underline">Unpair extension</button>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-fg-muted">The DERO Hive Browser Companion connects locally once paired with a one-time code.</p>
        </section>

        <section className="rounded-xl border border-accent/25 bg-accent-soft/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-fg">Context scope</span>
            <span className="rounded-full bg-bg-elev px-2 py-0.5 text-[10px] text-fg-muted">{included} source{included === 1 ? '' : 's'}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg/70 p-1">
            {([['chat', 'Chat'], ['workspace', 'Workspace'], ['pinned', 'Pinned']] as const).map(([value, label]) => (
              <button key={value} onClick={() => setMode(value)} className={`rounded-md px-1.5 py-1.5 text-[10px] font-medium transition ${mode === value ? 'bg-accent text-white shadow-sm' : 'text-fg-muted hover:bg-bg-elev hover:text-fg'}`}>{label}</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{mode === 'chat' ? 'Only the latest conversation turns are attached.' : mode === 'pinned' ? 'Only notes you pin here are attached.' : 'Recent chat turns and your pinned notes are attached.'}</p>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-fg">Pinned notes</h3>
              <p className="text-[10px] text-fg-subtle">Manual, local to this panel</p>
            </div>
            <button onClick={() => setAdding((open) => !open)} className="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-accent hover:border-accent/50 hover:bg-accent-soft">{adding ? 'Cancel' : '+ Add note'}</button>
          </div>
          {adding && <div className="space-y-2 rounded-xl border border-border bg-bg p-3">
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" className="w-full rounded-md border border-border bg-bg-input px-2 py-1.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent" />
            <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="Optional source URL" className="w-full rounded-md border border-border bg-bg-input px-2 py-1.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent" />
            <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Paste the text or details you want the agent to use…" rows={4} className="w-full resize-y rounded-md border border-border bg-bg-input px-2 py-1.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-accent" />
            <button onClick={addNote} className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">Pin note</button>
          </div>}
          {!adding && (notes.length === 0 ? <div className="rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-fg-subtle">Add a page summary, a link, or any working note. Nothing is fetched or shared until you send a prompt.</div> : <div className="space-y-2">{notes.map((note) => <article key={note.id} className="rounded-lg border border-border bg-bg/70 p-2.5"><div className="flex gap-2"><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-fg">{note.title || 'Untitled note'}</div>{note.url && <div className="truncate text-[10px] text-accent">{note.url}</div>}<p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-fg-muted">{note.text}</p></div><button onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))} className="h-5 w-5 rounded text-fg-subtle hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${note.title || 'note'}`}>×</button></div></article>)}</div>)}
        </section>

        <section className="rounded-xl border border-border bg-bg/70 p-3">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-fg">What Hive will see</h3><span className="text-[10px] text-success">Visible receipt</span></div>
          <div className="max-h-32 overflow-y-auto rounded-lg bg-bg-input p-2 font-mono text-[10px] leading-relaxed text-fg-muted whitespace-pre-wrap">{context || 'No context selected yet. Choose Chat or add a pinned note.'}</div>
          <p className="mt-2 text-[10px] leading-relaxed text-fg-subtle">{conversation?.title ? `Attached to “${conversation.title}”. ` : 'A new chat will be created when you send. '}Page content is treated as reference material, not instructions.</p>
        </section>
      </div>

      <footer className="border-t border-border p-3">
        <div className="mb-2 grid grid-cols-3 gap-1.5">{QUICK_ACTIONS.map((action) => <button key={action.label} onClick={() => compose(action.prompt)} className="rounded-lg border border-border bg-bg-elev px-1 py-1.5 text-[10px] font-medium text-fg-muted hover:border-accent/50 hover:text-accent">{action.label}</button>)}</div>
        <button onClick={() => compose('Use the supplied context to help with my next request.')} className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white shadow-elev-sm transition hover:bg-accent-hover">Add context to composer</button>
      </footer>
    </aside>
  );
}
