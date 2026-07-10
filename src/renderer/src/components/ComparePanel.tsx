import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { Message, ProviderConfig, StreamEvent } from '@shared/types';

type Model = { providerId: string; modelId: string };
type Result = { content: string; reasoning: string; done: boolean; error?: string; conversationId?: string };
type Side = 'a' | 'b';
const blank = (): Result => ({ content: '', reasoning: '', done: false });

function defaults(providers: ProviderConfig[]): { a: Model | null; b: Model | null } {
  const usable = providers.filter((p) => p.enabled && p.models.length);
  if (!usable.length) return { a: null, b: null };
  const a = usable[0]; const b = usable[1] || a;
  return { a: { providerId: a.id, modelId: a.models[0].id }, b: { providerId: b.id, modelId: (b === a ? a.models[1] || a.models[0] : b.models[0]).id } };
}

export function ComparePanel(): JSX.Element | null {
  const open = useAppStore((s) => s.compareOpen);
  const close = useAppStore((s) => s.closeCompare);
  const sourcePrompt = useAppStore((s) => s.comparePrompt);
  const providers = useAppStore((s) => s.providers);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const [prompt, setPrompt] = useState('');
  const [a, setA] = useState<Model | null>(null);
  const [b, setB] = useState<Model | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ a: Result; b: Result }>({ a: blank(), b: blank() });
  const sides = useRef(new Map<string, Side>());

  useEffect(() => { if (!open) return; const next = defaults(providers); const selected = selectedProviderId && selectedModel ? { providerId: selectedProviderId, modelId: selectedModel } : null; setPrompt(sourcePrompt); setA(selected || next.a); setB(next.b || selected || next.a); }, [open, providers, selectedModel, selectedProviderId, sourcePrompt]);
  const clear = useCallback(() => { sides.current.clear(); setResults({ a: blank(), b: blank() }); }, []);
  const stop = useCallback(() => { [results.a.conversationId, results.b.conversationId].forEach((id) => { if (id) void window.hive.chatAbort(id); }); setResults((r) => ({ a: { ...r.a, done: true }, b: { ...r.b, done: true } })); setRunning(false); }, [results]);

  const run = useCallback(async () => {
    if (!a || !b || !prompt.trim() || running) return;
    clear(); setRunning(true);
    const title = `Compare: ${prompt.trim().slice(0, 40)}${prompt.trim().length > 40 ? '...' : ''}`;
    const message: Message = { id: crypto.randomUUID(), role: 'user', content: prompt.trim(), createdAt: Date.now() };
    try {
      const [ca, cb] = await Promise.all([window.hive.convCreate({ title }), window.hive.convCreate({ title })]);
      sides.current = new Map([[ca.id, 'a'], [cb.id, 'b']]);
      setResults({ a: { ...blank(), conversationId: ca.id }, b: { ...blank(), conversationId: cb.id } });
      await Promise.all([window.hive.chatSend({ conversationId: ca.id, providerId: a.providerId, model: a.modelId, messages: [message] }), window.hive.chatSend({ conversationId: cb.id, providerId: b.providerId, model: b.modelId, messages: [message] })]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start the comparison.';
      setResults({ a: { ...blank(), done: true, error: message }, b: { ...blank(), done: true, error: message } }); setRunning(false);
    }
  }, [a, b, clear, prompt, running]);

  useEffect(() => { if (!running) return; return window.hive.onChatStream((event: StreamEvent) => { const side = sides.current.get(event.conversationId); if (!side) return; setResults((all) => { const current = all[side]; if (event.type === 'delta') return { ...all, [side]: { ...current, content: current.content + (event.content || ''), reasoning: current.reasoning + (event.reasoning || '') } }; if (event.type === 'error') return { ...all, [side]: { ...current, error: event.error } }; if (event.type === 'done') return { ...all, [side]: { ...current, done: true } }; return all; }); }); }, [running]);
  useEffect(() => { if (running && results.a.done && results.b.done) setRunning(false); }, [results, running]);
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (running) stop(); else close(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [close, open, running, stop]);
  if (!open) return null;
  const hasOutput = Object.values(results).some((r) => r.content || r.error || r.done);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="compare-title" className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elev shadow-2xl">
      <header className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 id="compare-title" className="text-base font-semibold">Compare responses</h2><p className="mt-0.5 text-xs text-fg-subtle">Run the same prompt side-by-side without changing your active chat.</p></div><button onClick={close} disabled={running} aria-label="Close comparison" className="rounded-md p-2 text-lg text-fg-subtle hover:bg-bg-input hover:text-fg disabled:opacity-40">×</button></header>
      <div className="flex-1 overflow-y-auto p-5"><label htmlFor="compare-prompt" className="mb-1.5 block text-xs font-medium text-fg-muted">Prompt</label><textarea id="compare-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} rows={4} placeholder="Ask a question, paste code, or describe a task..." className="input w-full resize-y text-sm leading-relaxed" />
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end"><Picker label="Response A" value={a} providers={providers} disabled={running} onChange={setA} /><button onClick={() => { setA(b); setB(a); }} disabled={running || !a || !b} title="Swap models" className="mx-auto rounded-md border border-border px-3 py-2 text-fg-subtle hover:bg-bg-input disabled:opacity-40">⇄</button><Picker label="Response B" value={b} providers={providers} disabled={running} onChange={setB} /></div>
        <div className="mt-4 flex items-center justify-between gap-3 border-b border-border pb-4"><p className="text-xs text-fg-subtle">{running ? 'Both models are generating independently.' : hasOutput ? 'Refine the prompt or choose new models to run again.' : 'Responses will stream below as they arrive.'}</p><div className="flex gap-2"><button onClick={clear} disabled={running || !hasOutput} className="rounded-md px-3 py-2 text-xs text-fg-muted hover:bg-bg-input disabled:opacity-40">Clear</button><button onClick={() => void run()} disabled={running || !prompt.trim() || !a || !b} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50">{running ? 'Comparing...' : 'Run comparison'}</button>{running && <button onClick={stop} className="rounded-md border border-border px-3 py-2 text-xs hover:bg-bg-input">Stop</button>}</div></div>
        <div className="mt-4 grid min-h-[300px] gap-4 lg:grid-cols-2"><Pane label="Response A" model={a} providers={providers} result={results.a} running={running} /><Pane label="Response B" model={b} providers={providers} result={results.b} running={running} /></div>
      </div>
    </section>
  </div>;
}

function Picker({ label, value, providers, disabled, onChange }: { label: string; value: Model | null; providers: ProviderConfig[]; disabled: boolean; onChange: (model: Model) => void }): JSX.Element {
  const options = useMemo(() => providers.filter((p) => p.enabled).flatMap((p) => p.models.map((m) => ({ key: `${p.id}:${m.id}`, providerId: p.id, modelId: m.id, label: `${p.name} — ${m.name}` }))), [providers]);
  return <div><label className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</label><select className="input w-full text-sm" value={value ? `${value.providerId}:${value.modelId}` : ''} disabled={disabled} onChange={(e) => { const option = options.find((x) => x.key === e.target.value); if (option) onChange(option); }}><option value="">Select a model</option>{options.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>;
}
function Pane({ label, model, providers, result, running }: { label: string; model: Model | null; providers: ProviderConfig[]; result: Result; running: boolean }): JSX.Element {
  const name = useMemo(() => { const p = providers.find((x) => x.id === model?.providerId); const m = p?.models.find((x) => x.id === model?.modelId); return m ? `${p?.name} — ${m.name}` : 'No model selected'; }, [model, providers]);
  const status = result.error ? 'Failed' : result.done ? 'Complete' : running ? 'Generating' : 'Ready';
  return <article className="flex min-h-[300px] flex-col overflow-hidden rounded-xl border border-border bg-bg"><header className="flex items-center justify-between gap-3 border-b border-border bg-bg-sidebar/40 px-4 py-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">{label}</p><p title={name} className="mt-0.5 truncate text-xs font-medium">{name}</p></div><span className="rounded-full bg-bg-input px-2 py-1 text-[10px] text-fg-subtle">{status}</span></header><div className="min-h-0 flex-1 overflow-auto p-4"><div className="select-text whitespace-pre-wrap text-sm leading-7">{result.content || (!result.error && <p className="flex min-h-[180px] items-center justify-center text-center text-fg-subtle">{running ? 'Waiting for a response...' : 'Waiting to compare'}</p>)}</div>{result.error && <p className="mt-3 rounded-md bg-danger/10 p-3 text-xs text-danger">{result.error}</p>}{result.reasoning && <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-xs text-fg-muted">Reasoning</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-fg-subtle">{result.reasoning}</pre></details>}</div></article>;
}

