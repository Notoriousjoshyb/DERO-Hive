import { useState, useEffect } from 'react';
import { HiveLogo } from './HiveLogo';
import { useAppStore } from '../stores/app';

export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [fullscreen, setFullscreen] = useState(false);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const visionOpen = useAppStore((s) => s.visionOpen);
  const toggleVision = useAppStore((s) => s.toggleVision);
  const companionOpen = useAppStore((s) => s.companionOpen);
  const toggleCompanion = useAppStore((s) => s.toggleCompanion);
  const lastStreamErrorAt = useAppStore((s) => s.lastStreamErrorAt);
  const lastStreamSuccessAt = useAppStore((s) => s.lastStreamSuccessAt);

  const intermittent = online && !!lastStreamErrorAt && (!lastStreamSuccessAt || lastStreamErrorAt > lastStreamSuccessAt) && (Date.now() - lastStreamErrorAt < 30000);

  useEffect(() => {
    void window.hive.winIsMaximized().then(setMaximized);
    const interval = setInterval(() => {
      void window.hive.winIsMaximized().then(setMaximized);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const off = window.hive.onFullscreenChanged(({ fullscreen: fs }) => setFullscreen(fs));
    return () => off();
  }, []);

  // Network connectivity indicator — reflects the OS-level connection state.
  useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return (
    <div className={`bg-bg-sidebar border-b border-border flex items-center justify-between overflow-hidden titlebar-drag select-none transition-transform duration-200 ${fullscreen ? 'h-0 border-none -translate-y-full' : 'h-9'}`}>
      <div className="flex min-w-0 items-center gap-2 px-2 sm:px-3 text-xs">
        <span className="hidden flex-shrink-0 sm:block"><HiveLogo size={16} /></span>
        <span className="hidden font-semibold tracking-wide text-fg sm:inline">
          DERO <span className="text-accent">Hive</span>
        </span>
        <span
          className={`hidden h-1.5 w-1.5 flex-shrink-0 rounded-full sm:block ${
            !online ? 'bg-danger animate-pulse'
              : intermittent ? 'bg-warn animate-pulse'
              : 'bg-success'
          }`}
          title={!online ? 'Offline — no network connection' : intermittent ? 'Intermittent connection' : 'Online'}
        />
        <span className="hidden h-4 w-px bg-border mx-1 sm:block" />
        <div className="flex flex-shrink-0 items-center gap-0.5 titlebar-no-drag">
          <button
            onClick={toggleSidebar}
            className={`p-1.5 rounded-md transition-colors ${sidebarOpen ? 'text-fg bg-bg-elev' : 'text-fg-subtle hover:text-fg hover:bg-bg-elev'}`}
            title="Toggle left sidebar (Ctrl+B)"
            aria-label="Toggle left sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="4.5" y1="2" x2="4.5" y2="12" stroke="currentColor" strokeWidth="1.2" />
              {sidebarOpen && <rect x="1.6" y="2.6" width="2.4" height="8.8" rx="0.6" fill="currentColor" opacity="0.35" />}
            </svg>
          </button>
          <button
            onClick={toggleRightSidebar}
            className={`p-1.5 rounded-md transition-colors ${rightSidebarOpen ? 'text-fg bg-bg-elev' : 'text-fg-subtle hover:text-fg hover:bg-bg-elev'}`}
            title="Toggle right sidebar"
            aria-label="Toggle right sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="9.5" y1="2" x2="9.5" y2="12" stroke="currentColor" strokeWidth="1.2" />
              {rightSidebarOpen && <rect x="10" y="2.6" width="2.4" height="8.8" rx="0.6" fill="currentColor" opacity="0.35" />}
            </svg>
          </button>
          <button
            onClick={toggleVision}
            className={`p-1.5 rounded-md transition-colors ${visionOpen ? 'text-accent bg-bg-elev' : 'text-fg-subtle hover:text-fg hover:bg-bg-elev'}`}
            title="Toggle Vision workspace (Ctrl+Shift+C)"
            aria-label="Toggle Vision workspace"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="2.2" fill={visionOpen ? 'currentColor' : 'none'} fillOpacity={visionOpen ? 0.35 : 0} />
            </svg>
          </button>
          <button
            onClick={toggleCompanion}
            className={`p-1.5 rounded-md transition-colors ${companionOpen ? 'text-accent bg-bg-elev' : 'text-fg-subtle hover:text-fg hover:bg-bg-elev'}`}
            title="Toggle Hive Companion"
            aria-label="Toggle Hive Companion"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3.5h10v8.2a1.3 1.3 0 01-1.3 1.3H6.4L3 14V3.5z" />
              <path d="M5.5 6.5h5M5.5 9h3.2" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex flex-shrink-0 titlebar-no-drag items-center">
        <button
          onClick={() => window.hive.winMinimize()}
          className="h-9 w-9 sm:w-12 flex items-center justify-center hover:bg-bg-elev text-fg-muted hover:text-fg"
          aria-label="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10v1H0z" fill="currentColor" /></svg>
        </button>
        <button
          onClick={() => window.hive.winMaximize().then(setMaximized)}
          className="h-9 w-9 sm:w-12 flex items-center justify-center hover:bg-bg-elev text-fg-muted hover:text-fg"
          aria-label="Maximize"
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 0v2H0v8h8V8h2V0H2zm6 8H1V3h7v5zm2-7v6h-1V3H5V1h5z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" /></svg>
          )}
        </button>
        <button
          onClick={() => window.hive.winClose()}
          className="h-9 w-9 sm:w-12 flex items-center justify-center hover:bg-danger text-fg-muted hover:text-white"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 3.59L1.59.18.18 1.59 3.59 5 .18 8.41l1.41 1.41L5 6.41l3.41 3.41 1.41-1.41L6.41 5 9.82 1.59 8.41.18 5 3.59z" fill="currentColor" /></svg>
        </button>
      </div>
    </div>
  );
}
