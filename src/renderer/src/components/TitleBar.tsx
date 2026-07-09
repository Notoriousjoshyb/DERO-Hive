import { useState, useEffect } from 'react';
import { HiveLogo } from './HiveLogo';
import { useAppStore } from '../stores/app';

export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);

  useEffect(() => {
    void window.hive.winIsMaximized().then(setMaximized);
    const interval = setInterval(() => {
      void window.hive.winIsMaximized().then(setMaximized);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-9 bg-bg-sidebar border-b border-border flex items-center justify-between titlebar-drag select-none">
      <div className="flex items-center gap-2 px-3 text-xs">
        <HiveLogo size={16} />
        <span className="font-semibold tracking-wide text-fg">
          DERO <span className="text-accent">Hive</span>
        </span>
        <span className="w-px h-4 bg-border mx-1" />
        <div className="flex items-center gap-0.5 titlebar-no-drag">
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
        </div>
      </div>
      <div className="flex titlebar-no-drag items-center">
        <button
          onClick={() => window.hive.winMinimize()}
          className="w-12 h-9 flex items-center justify-center hover:bg-bg-elev text-fg-muted hover:text-fg"
          aria-label="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10v1H0z" fill="currentColor" /></svg>
        </button>
        <button
          onClick={() => window.hive.winMaximize().then(setMaximized)}
          className="w-12 h-9 flex items-center justify-center hover:bg-bg-elev text-fg-muted hover:text-fg"
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
          className="w-12 h-9 flex items-center justify-center hover:bg-danger text-fg-muted hover:text-white"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 3.59L1.59.18.18 1.59 3.59 5 .18 8.41l1.41 1.41L5 6.41l3.41 3.41 1.41-1.41L6.41 5 9.82 1.59 8.41.18 5 3.59z" fill="currentColor" /></svg>
        </button>
      </div>
    </div>
  );
}