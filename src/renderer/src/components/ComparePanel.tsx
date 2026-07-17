import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { Message, ProviderConfig, StreamEvent } from '@shared/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const [running, setRunning] = useState<'a' | 'b' | 'both' | null>(null);
  const [results, setResults] = useState<{ a: Result; b: Result }>({ a: blank(), b: blank() });
  const sides = useRef(new Map<string, Side>());

  useEffect(() => { if (!open) return; const next = defaults(providers); const selected = selectedProviderId && selectedModel ? { providerId: selectedProviderId, modelId: selectedModel } : null; setPrompt(sourcePrompt); setA(selected || next.a); setB(next.b || selected || next.a); }, [open, providers, selectedModel, selectedProviderId, sourcePrompt]);
  const clear = useCallback(() => { sides.current.clear(); setResults({ a: blank(), b: blank() }); }, []);

  const stop = useCallback(() => {
    [results.a.conversationId, results.b.conversationId].forEach((id) => { if (id) void window.hive.chatAbort(id); });
    // Mark both panes done here: clearing `running` unsubscribes the stream
    // effect on the next render, so the abort's own done/error events never
    // arrive to do it. Without this a stopped run reads back as "Ready".
    setResults((r) => ({ a: { ...r.a, done: true }, b: { ...r.b, done: true } }));
    setRunning(null);
  }, [results]);

  const runSide = useCallback(async (side: Side) => {
    const model = side === 'a' ? a : b;
    if (!model || !prompt.trim()) return;
    setRunning(side);
    const title = `Compare: ${prompt.trim().slice(0, 40)}...`;
    const message: Message = { id: crypto.randomUUID(), role: 'user', content: prompt.trim(), createdAt: Date.now() };
    try {
      const conv = await window.hive.convCreate({ title });
      sides.current.set(conv.id, side);
      setResults((r) => ({ ...r, [side]: { ...blank(), conversationId: conv.id } }));
      await window.hive.chatSend({ conversationId: conv.id, providerId: model.providerId, model: model.modelId, messages: [message] });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to start.';
      setResults((r) => ({ ...r, [side]: { ...blank(), done: true, error: msg } }));
      setRunning(null);
    }
  }, [a, b, prompt]);

  const runBoth = useCallback(async () => {
    if (!a || !b || !prompt.trim()) return;
    setRunning('both');
    clear();
    const title = `Compare: ${prompt.trim().slice(0, 40)}...`;
    const message: Message = { id: crypto.randomUUID(), role: 'user', content: prompt.trim(), createdAt: Date.now() };
    const ids: string[] = [];
    try {
      for (const side of [{ model: a, id: 'a' as Side }, { model: b, id: 'b' as Side }]) {
        const conv = await window.hive.convCreate({ title });
        ids.push(conv.id);
        sides.current.set(conv.id, side.id);
        setResults((r) => ({ ...r, [side.id]: { ...blank(), conversationId: conv.id } }));
      }
      await Promise.all([
        window.hive.chatSend({ conversationId: ids[0], providerId: a.providerId, model: a.modelId, messages: [message] }),
        window.hive.chatSend({ conversationId: ids[1], providerId: b.providerId, model: b.modelId, messages: [message] }),
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to start.';
      setResults({ a: { ...blank(), done: true, error: msg }, b: { ...blank(), done: true, error: msg } });
      setRunning(null);
    }
  }, [a, b, clear, prompt]);

  // Stream results
  useEffect(() => {
    if (!running) return;
    return window.hive.onChatStream((event: StreamEvent) => {
      const side = sides.current.get(event.conversationId);
      if (!side) return;
      setResults((all) => {
        const current = all[side];
        if (event.type === 'delta') return { ...all, [side]: { ...current, content: current.content + (event.content || ''), reasoning: current.reasoning + (event.reasoning || '') } };
        if (event.type === 'error') return { ...all, [side]: { ...current, error: event.error, done: true } };
        if (event.type === 'done') return { ...all, [side]: { ...current, done: true } };
        return all;
      });
    });
  }, [running]);

  // Check completion
  useEffect(() => {
    if (running === 'both' && results.a.done && results.b.done) setRunning(null);
    else if (running === 'a' && results.a.done) setRunning(null);
    else if (running === 'b' && results.b.done) setRunning(null);
  }, [results, running]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (running) stop(); else close(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, open, running, stop]);

  if (!open) return null;
  const hasOutput = Object.values(results).some((r) => r.content || r.error || r.done);
  const isRunning = running !== null;

  const copyContent = async (side: Side): Promise<void> => {
    const text = results[side].content;
    if (text) await navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !isRunning) close(); }}>
      <section role="dialog" aria-modal="true" className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elev shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Compare responses</h2>
            <p className="mt-0.5 text-xs text-fg-subtle">Run the same prompt side-by-side.</p>
          </div>
          <button onClick={close} disabled={isRunning} className="rounded-md p-2 text-lg text-fg-subtle hover:bg-bg-input hover:text-fg disabled:opacity-40">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Prompt */}
          <label className="mb-1.5 block text-xs font-medium text-fg-muted">Prompt</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={isRunning} rows={3} className="input w-full resize-y text-sm leading-relaxed" />

          {/* Model pickers */}
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
            <Picker label="Response A" value={a} providers={providers} disabled={isRunning} onChange={setA} />
            <button onClick={() => { setA(b); setB(a); }} disabled={isRunning || !a || !b} title="Swap" className="mx-auto rounded-md border border-border px-3 py-2 text-fg-subtle hover:bg-bg-input disabled:opacity-40">⇄</button>
            <Picker label="Response B" value={b} providers={providers} disabled={isRunning} onChange={setB} />
          </div>

          {/* Controls */}
          <div className="mt-4 flex items-center justify-between gap-3 border-b border-border pb-4">
            <p className="text-xs text-fg-subtle">
              {isRunning ? 'Generating...' : hasOutput ? 'Refine or re-run individual sides.' : 'Responses will stream below.'}
            </p>
            <div className="flex gap-2">
              <button onClick={clear} disabled={isRunning || !hasOutput} className="rounded-md px-3 py-2 text-xs text-fg-muted hover:bg-bg-input disabled:opacity-40">Clear</button>
              <button onClick={() => void runBoth()} disabled={isRunning || !prompt.trim() || !a || !b} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50">Run Both</button>
              {isRunning && <button onClick={stop} className="rounded-md border border-border px-3 py-2 text-xs hover:bg-bg-input">Stop</button>}
            </div>
          </div>

          {/* Results */}
          <div className="mt-4 grid min-h-[300px] gap-4 lg:grid-cols-2">
            <Pane label="A" result={results.a} running={running === 'a' || running === 'both'} model={a} providers={providers}
              onReRun={() => { setResults((r) => ({ ...r, a: blank() })); void runSide('a'); }}
              onCopy={() => void copyContent('a')}
              reRunDisabled={!a || !prompt.trim() || isRunning} />
            <Pane label="B" result={results.b} running={running === 'b' || running === 'both'} model={b} providers={providers}
              onReRun={() => { setResults((r) => ({ ...r, b: blank() })); void runSide('b'); }}
              onCopy={() => void copyContent('b')}
              reRunDisabled={!b || !prompt.trim() || isRunning} />
          </div>
        </div>
      </section>
    </div>
  );
}

function Picker({ label, value, providers, disabled, onChange }: { label: string; value: Model | null; providers: ProviderConfig[]; disabled: boolean; onChange: (model: Model) => void }): JSX.Element {
  const options = useMemo(() => providers.filter((p) => p.enabled).flatMap((p) => p.models.map((m) => ({ key: `${p.id}:${m.id}`, providerId: p.id, modelId: m.id, label: `${p.name} — ${m.name}` }))), [providers]);
  return (
    <div><label className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</label>
      <select className="input w-full text-sm" value={value ? `${value.providerId}:${value.modelId}` : ''} disabled={disabled}
        onChange={(e) => { const o = options.find((x) => x.key === e.target.value); if (o) onChange(o); }}>
        <option value="">Select a model</option>
        {options.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
    </div>
  );
}

function Pane({ label, result, running, model, providers, onReRun, onCopy, reRunDisabled }: {
  label: string; result: Result; running: boolean; model: Model | null; providers: ProviderConfig[];
  onReRun: () => void; onCopy: () => void; reRunDisabled: boolean;
}): JSX.Element {
  const name = useMemo(() => { const p = providers.find((x) => x.id === model?.providerId); const m = p?.models.find((x) => x.id === model?.modelId); return m ? `${p?.name} — ${m.name}` : 'No model selected'; }, [model, providers]);
  const status = result.error ? 'Failed' : result.done ? 'Complete' : running ? 'Generating' : 'Ready';
  const tokenEstimate = useMemo(() => result.content ? Math.ceil(result.content.length / 4) : 0, [result.content]);

  return (
    <article className="flex min-h-[300px] flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-bg-sidebar/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">Response {label}</p>
          <p title={name} className="mt-0.5 truncate text-xs font-medium">{name}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-bg-input px-2 py-1 text-[10px] text-fg-subtle">{status}</span>
          {result.done && !result.error && (
            <span className="rounded-full bg-bg-input px-2 py-1 text-[10px] text-fg-subtle tabular-nums">~{tokenEstimate} tok</span>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {result.content ? (
          <div className="prose prose-sm max-w-none select-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown>
          </div>
        ) : result.error ? (
          <p className="rounded-md bg-danger/10 p-3 text-xs text-danger">{result.error}</p>
        ) : (
          <p className="flex min-h-[180px] items-center justify-center text-center text-fg-subtle">
            {running ? 'Generating...' : 'Waiting'}
          </p>
        )}
        {result.reasoning && (
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs text-fg-muted">Reasoning</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-fg-subtle">{result.reasoning}</pre>
          </details>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-4 py-2">
        <button onClick={onReRun} disabled={reRunDisabled} className="px-2 py-1 text-[10px] rounded border border-border text-fg-muted hover:bg-bg-input disabled:opacity-40">Re-run</button>
        <button onClick={onCopy} disabled={!result.content} className="px-2 py-1 text-[10px] rounded border border-border text-fg-muted hover:bg-bg-input disabled:opacity-40">Copy</button>
      </div>
    </article>
  );
}
