import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';

export function CompactionToast(): JSX.Element | null {
  const lastCompaction = useAppStore((s) => s.lastCompaction);
  const dismissLastCompaction = useAppStore((s) => s.dismissLastCompaction);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastCompaction) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [lastCompaction]);

  if (!lastCompaction || !visible) return null;

  const beforeK = Math.round(lastCompaction.beforeTokens / 1000);
  const afterK = Math.round(lastCompaction.afterTokens / 1000);
  const savedK = Math.round(lastCompaction.tokensSaved / 1000);
  const pctSaved = lastCompaction.beforeTokens > 0
    ? Math.round((lastCompaction.tokensSaved / lastCompaction.beforeTokens) * 100)
    : 0;

  return (
    <div className="fixed top-12 right-4 z-50 w-80 bg-bg-elev/95 border border-border rounded-xl shadow-2xl backdrop-blur-sm animate-slide-down pointer-events-auto">
      <div className="flex items-start gap-2 p-3">
        <div className="flex-shrink-0 mt-0.5">
          <CompactionIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-fg">Context auto-compacted</div>
          <div className="text-[11px] text-fg-muted mt-0.5">
            Summarized <span className="font-mono text-fg">{lastCompaction.removedCount}</span> older messages
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-fg-subtle font-mono tabular-nums">
            <span>
              <span className="text-fg-muted">{beforeK}k</span>
              <span className="mx-1">→</span>
              <span className="text-success">{afterK}k</span>
            </span>
            <span className="text-success">−{savedK}k ({pctSaved}%)</span>
          </div>
          <div className="mt-1.5 h-1 bg-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-success transition-all duration-500"
              style={{ width: `${pctSaved}%` }}
            />
          </div>
        </div>
        <button
          onClick={dismissLastCompaction}
          className="flex-shrink-0 text-fg-subtle hover:text-fg text-sm leading-none px-1"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function CompactionIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
      <path d="M7 7h6M7 10h4M7 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-fg-subtle" />
      <circle cx="15.5" cy="4.5" r="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1" className="text-success" />
      <path d="M14 4.5l1 1 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-success" />
    </svg>
  );
}