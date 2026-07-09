import { useState } from 'react';
import { useAppStore } from '../stores/app';

export function PermissionDialog(): JSX.Element | null {
  const pending = useAppStore((s) => s.pendingPermissions);
  const remove = useAppStore((s) => s.removePendingPermission);
  const [remember, setRemember] = useState(false);

  if (pending.length === 0) return null;
  const req = pending[0];

  const decide = async (decision: 'allow' | 'deny', rememberDecision = false): Promise<void> => {
    await window.hive.toolPermissionDecide({ requestId: req.requestId, decision });
    if (rememberDecision) {
      // Session-only: auto-allow until the app restarts. Does NOT persist —
      // the saved toolApprovalMode setting is left untouched.
      useAppStore.getState().setSessionAutoAllowTools(true);
    }
    remove(req.requestId);
    setRemember(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center px-4 animate-fade-in">
      <div className="bg-bg-elev border border-border rounded-2xl shadow-elev-lg max-w-lg w-full p-5 animate-slide-up">
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
              The model wants to run{' '}
              <span className="font-mono text-accent bg-accent-soft px-1.5 py-0.5 rounded-md">{req.toolName}</span>
            </p>
          </div>
        </div>

        {req.description && (
          <p className="text-sm text-fg-muted mb-3 leading-relaxed">{req.description}</p>
        )}

        <pre className="bg-bg-code border border-border rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 mb-4 text-fg-muted leading-relaxed">
          <code>{JSON.stringify(req.args, null, 2)}</code>
        </pre>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
          <label className="flex items-center gap-1.5 text-xs text-fg-muted sm:mr-auto cursor-pointer">
            <input
              type="checkbox"
              id="remember"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="accent-accent"
            />
            Don't ask again for this session
          </label>
          <button
            onClick={() => void decide('deny')}
            className="px-4 py-1.5 rounded-lg border border-border bg-bg hover:bg-bg-input hover:border-border-strong text-fg text-sm transition"
          >
            Deny
          </button>
          <button
            onClick={() => void decide('allow', remember)}
            className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
