import { useAppStore } from '../stores/app';
import { HiveLogo } from './HiveLogo';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function EmptyState(): JSX.Element {
  const providers = useAppStore((s) => s.providers);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const skills = useAppStore((s) => s.skills);

  return (
    <div className="h-full overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="relative mb-7 animate-rise" style={{ animationDelay: '0ms' }}>
        <div
          className="logo-glow absolute inset-0 rounded-full blur-2xl"
          style={{ background: 'var(--accent-glow)' }}
        />
        <HiveLogo size={76} className="relative drop-shadow-md" />
      </div>
      <h1 className="text-[26px] font-semibold text-fg mb-2 tracking-tight animate-rise" style={{ animationDelay: '60ms' }}>
        {greeting()} — welcome to DERO Hive
      </h1>
      <p className="text-fg-muted mb-9 max-w-md text-[15px] leading-relaxed animate-rise" style={{ animationDelay: '120ms' }}>
        Multi-provider AI chat with tool use, MCP servers, and{' '}
        <button
          onClick={() => useAppStore.getState().setVisionOpen(true)}
          className="text-accent hover:underline font-medium"
          title="Open the Vision workspace"
        >
          Vision
        </button>
        {' '}— a live workspace where apps, diagrams, and documents you ask for
        open as interactive, editable artifacts.
      </p>

      {providers.length === 0 ? (
        <div className="bg-bg-elev border border-border rounded-2xl p-6 max-w-md shadow-elev-md animate-rise" style={{ animationDelay: '180ms' }}>
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-warn/15 text-warn flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 5v4M8 11.5v.01" />
              <path d="M7.13 2.5a1 1 0 011.74 0l5.5 9.5a1 1 0 01-.87 1.5H2.5a1 1 0 01-.87-1.5l5.5-9.5z" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-fg text-sm font-semibold mb-1.5">No providers configured</div>
          <p className="text-fg-muted text-sm mb-5 leading-relaxed">
            Add an API key from OpenCode Zen, OpenAI, Kimi, or any OpenAI-compatible service to get started.
          </p>
          <button
            onClick={() => setSettingsOpen(true)}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition-all hover:shadow-elev-md"
          >
            Open settings
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
          {skills.filter((s) => s.enabled).slice(0, 6).map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                const ta = document.querySelector('textarea');
                if (ta) {
                  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
                  setter.call(ta, s.slashCommand + ' ');
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                  ta.focus();
                }
              }}
              className="group text-left p-4 bg-bg-elev border border-border rounded-xl transition-all duration-150 hover:border-accent/40 hover:shadow-elev-md hover:-translate-y-0.5 animate-rise"
              style={{ animationDelay: `${180 + i * 50}ms` }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-accent-soft text-accent font-mono text-[11px] group-hover:bg-accent group-hover:text-white transition-colors">
                  {s.slashCommand}
                </span>
              </div>
              <div className="text-sm font-medium text-fg">{s.name}</div>
              <div className="text-xs text-fg-muted mt-1 leading-relaxed line-clamp-2">{s.description}</div>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
