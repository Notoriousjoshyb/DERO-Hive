import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';
import { executeInstruction, disposeAgent } from '../lib/pageAgent';

/**
 * Experimental Agent mode: a floating command bar that hands natural-language
 * instructions to an in-page GUI agent (page-agent), which operates the app's
 * own UI. Gated by Settings → General → "Agent mode".
 */
export function AgentBar(): JSX.Element | null {
  const enabled = useAppStore((s) => s.settings.agentModeEnabled);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  // Tear down the agent + proxy when the feature is switched off.
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      disposeAgent();
    }
  }, [enabled]);

  if (!enabled) return null;

  const run = async (): Promise<void> => {
    const task = instruction.trim();
    if (!task || running) return;
    setRunning(true);
    setStatus(null);
    try {
      const result = await executeInstruction(task);
      setStatus(result);
      if (result.ok) setInstruction('');
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2">
      {open && (
        <div className="w-96 p-3 bg-bg-elev border border-border rounded-xl shadow-elev-lg space-y-2 animate-slide-up">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Agent mode</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warn/15 text-warn font-medium">experimental</span>
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void run(); } }}
            rows={2}
            placeholder={'Tell the agent what to do in the app, e.g. "open settings and switch to the Providers tab"'}
            className="w-full bg-bg-input border border-border rounded-lg px-2.5 py-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-none"
            autoFocus
          />
          {status && (
            <div className={`text-xs ${status.ok ? 'text-success' : 'text-danger'} whitespace-pre-wrap max-h-24 overflow-y-auto`}>
              {status.message}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={() => void run()}
              disabled={running || !instruction.trim()}
              className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? 'Working…' : 'Run'}
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Agent mode (experimental)"
        className="w-10 h-10 rounded-full bg-accent hover:bg-accent-hover text-white shadow-elev-lg flex items-center justify-center transition"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="10" height="8" rx="2" />
          <path d="M8 5V2M5.5 2h5" />
          <circle cx="6" cy="9" r="0.5" fill="currentColor" />
          <circle cx="10" cy="9" r="0.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
