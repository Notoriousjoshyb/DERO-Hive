import { useEffect, useRef, useState } from 'react';
import type { SwarmMode } from '@shared/types';
import { SWARM_SPECIALISTS } from '@shared/swarm';
import { useAppStore } from '../stores/app';
import { VoiceInput } from './VoiceInput';

export function SwarmModal(): JSX.Element | null {
  const open = useAppStore((state) => state.swarmOpen);
  const initialPrompt = useAppStore((state) => state.swarmPrompt);
  const autoLaunch = useAppStore((state) => state.swarmAutoLaunch);
  const close = useAppStore((state) => state.closeSwarm);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mode, setMode] = useState<SwarmMode>('research');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const launchRef = useRef<() => void>(() => undefined);
  const dictationBaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt(initialPrompt);
    setMode('research');
    setLaunching(false);
    setError('');
  }, [open, initialPrompt]);

  useEffect(() => {
    if (!open || !autoLaunch || !initialPrompt.trim()) return;
    const timer = window.setTimeout(() => launchRef.current(), 0);
    return () => window.clearTimeout(timer);
  }, [open, autoLaunch, initialPrompt]);

  if (!open) return null;

  const launch = async (): Promise<void> => {
    const task = prompt.trim();
    if (!task || launching) return;
    const state = useAppStore.getState();
    const providerId = state.selectedProviderId || state.providers[0]?.id;
    const provider = state.providers.find((item) => item.id === providerId);
    const model = state.selectedModel || provider?.models[0]?.id;
    if (!providerId || !model) {
      setError('Choose a provider and model before launching a swarm.');
      return;
    }

    setLaunching(true);
    setError('');
    try {
      const run = await window.hive.swarmStart({
        prompt: task,
        mode: autoLaunch ? 'research' : mode,
        providerId,
        model,
        conversationId: state.currentConversationId
      });
      state.upsertSwarmRun(run);
      await state.loadConversations();
      if (run.conversationId) await state.selectConversation(run.conversationId);
      close();
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
      setLaunching(false);
    }
  };
  launchRef.current = () => { void launch(); };

  const onVoiceResult = (transcript: string, isFinal: boolean): void => {
    setPrompt((current) => {
      if (dictationBaseRef.current === null) {
        dictationBaseRef.current = current && !/\s$/.test(current) ? `${current} ` : current;
      }
      return dictationBaseRef.current + transcript;
    });
    if (isFinal) dictationBaseRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-5 backdrop-blur-sm" onClick={() => !launching && close()}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-bg-elev shadow-elev-lg" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-fg">Launch native swarm</h2>
            <p className="mt-1 text-xs text-fg-subtle">Three specialists work in parallel, then verification and synthesis finish the result.</p>
          </div>
          <button onClick={close} disabled={launching} className="rounded-md p-1 text-fg-subtle hover:bg-bg-input hover:text-fg disabled:opacity-40" aria-label="Close">×</button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="swarm-task" className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Task</label>
              <VoiceInput onResult={onVoiceResult} />
            </div>
            <textarea id="swarm-task" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={launching} rows={5} className="w-full resize-y rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-fg outline-none focus:border-accent/60 disabled:opacity-60" />
          </div>

          <fieldset disabled={launching} className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Mode</legend>
            {(['research', 'build'] as const).map((value) => (
              <label key={value} className={`rounded-lg border p-3 text-xs ${mode === value ? 'border-accent/60 bg-accent-soft/40' : 'border-border bg-bg-input/40'}`}>
                <input type="radio" name="swarm-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mr-2 accent-accent" />
                <span className="font-medium capitalize text-fg">{value}</span>
                <span className="mt-1 block text-[10px] text-fg-subtle">{value === 'research' ? 'Read-only repository investigation.' : 'Clean git project; changes stay isolated until Apply.'}</span>
              </label>
            ))}
          </fieldset>

          <section aria-labelledby="swarm-team-heading" className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="swarm-team-heading" className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Five-role team</h3>
              <span className="font-mono text-[10px] text-accent">3 → 1 → 1</span>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SWARM_SPECIALISTS.map((role) => (
                <li key={role.label} className="rounded-md border border-border bg-bg px-2.5 py-2 text-xs font-medium text-fg">{role.label}</li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-fg-muted">
              <span className="rounded-md border border-border bg-bg px-2.5 py-1.5">Verifier</span>
              <span aria-hidden="true" className="text-accent">→</span>
              <span className="rounded-md border border-border bg-bg px-2.5 py-1.5">Synthesizer</span>
            </div>
          </section>

          {error && <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={close} disabled={launching} className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-input disabled:opacity-40">Cancel</button>
          <button onClick={() => void launch()} disabled={launching || !prompt.trim()} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">{launching ? 'Starting…' : 'Launch'}</button>
        </div>
      </div>
    </div>
  );
}
