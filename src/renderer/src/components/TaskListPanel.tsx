import { useAppStore } from '../stores/app';

export function TaskListPanel(): JSX.Element | null {
  const todos = useAppStore((s) => s.todos);
  const visible = useAppStore((s) => s.taskListVisible);
  const expanded = useAppStore((s) => s.taskListExpanded);
  const toggleExpanded = useAppStore((s) => s.toggleTaskListExpanded);
  const setVisible = useAppStore((s) => s.setTaskListVisible);

  if (!visible || todos.length === 0) return null;

  const total = todos.length;
  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.find((t) => t.status === 'in_progress');
  const allDone = completed === total;

  // When collapsed, show the active/in-progress task (or last one done) as a one-line summary
  const headline =
    inProgress?.active_form || inProgress?.content ||
    (allDone ? 'All tasks complete' : todos[0]?.content || 'Tasks');

  return (
    <div className="mb-2 bg-bg-elev border border-border rounded-xl overflow-hidden text-xs shadow-elev-md animate-slide-up">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={toggleExpanded}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-fg transition"
          aria-label={expanded ? 'Collapse task list' : 'Expand task list'}
        >
          <span className="flex-shrink-0">
            {allDone ? <CheckCircleIcon /> : <SpinnerIcon />}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex-shrink-0">
            Tasks
          </span>
          <span className="text-fg-muted truncate">
            {headline}
          </span>
        </button>
        <span className="text-[10px] text-fg-subtle font-mono tabular-nums flex-shrink-0 inline-flex items-center gap-1">
          <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${allDone ? 'bg-success/20 text-success' : 'bg-accent/20 text-accent'}`}>
            <span className="text-[9px] font-semibold leading-none">{completed}</span>
          </span>
          <span className="text-fg-subtle">·</span>
          <span>{total}</span>
        </span>
        <div className="w-12 h-1 bg-bg rounded-full overflow-hidden flex-shrink-0">
          <div
            className={`h-full transition-all ${allDone ? 'bg-success' : 'bg-accent'}`}
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>
        <button
          onClick={toggleExpanded}
          className={`text-fg-subtle hover:text-fg flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => setVisible(false)}
          className="text-fg-subtle hover:text-fg text-sm leading-none flex-shrink-0 px-1"
          aria-label="Hide task list"
          title="Hide"
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2 pt-1 space-y-0.5 border-t border-border/60 max-h-48 overflow-y-auto">
          {todos.map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] leading-snug py-0.5">
              <span className="mt-0.5 flex-shrink-0">
                {t.status === 'completed' ? (
                  <CheckIcon className="text-success" />
                ) : t.status === 'in_progress' ? (
                  <DotIcon className="text-accent animate-pulse" />
                ) : (
                  <CircleIcon className="text-fg-subtle" />
                )}
              </span>
              <span
                className={
                  t.status === 'completed'
                    ? 'text-fg-subtle line-through'
                    : t.status === 'in_progress'
                    ? 'text-fg'
                    : 'text-fg-muted'
                }
              >
                {t.active_form || t.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckCircleIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-success flex-shrink-0">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" className="flex-shrink-0 animate-spin text-accent" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M7 1.5a5.5 5.5 0 015.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" className={className} fill="none">
      <circle cx="6" cy="6" r="5" fill="currentColor" fillOpacity="0.15" />
      <path d="M3.5 6.2l1.7 1.7L8.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" className={className} fill="currentColor">
      <circle cx="6" cy="6" r="3" />
    </svg>
  );
}

function CircleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" className={className} fill="none">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}