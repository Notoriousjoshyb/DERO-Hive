import { useEffect, useState } from 'react';
import { GeneralPanel } from './GeneralPanel';
import { ProvidersPanel } from './ProvidersPanel';
import { McpPanel } from './McpPanel';
import { DiscoverPanel } from './DiscoverPanel';
import { SkillsPanel } from './SkillsPanel';
import { ToolsPanel } from './ToolsPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { PromptsPanel } from './PromptsPanel';

interface Props {
  onClose: () => void;
}

type Tab = 'general' | 'providers' | 'projects' | 'mcp' | 'discover' | 'skills' | 'prompts' | 'tools';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'providers', label: 'Providers' },
  { id: 'projects', label: 'Projects' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'discover', label: 'Discover' },
  { id: 'skills', label: 'Skills' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'tools', label: 'Tools & Permissions' }
];

export function SettingsModal({ onClose }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-6 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="bg-bg-elev border border-border rounded-2xl shadow-elev-lg w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border">
          <h2 id="settings-title" className="text-lg font-semibold tracking-tight">Settings</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-input transition"
            aria-label="Close settings"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <nav aria-label="Settings sections" className="w-48 border-r border-border bg-bg-sidebar/50 py-3 px-2 space-y-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative w-full text-left px-3 py-2 text-sm rounded-lg transition-colors duration-100 ${
                  tab === t.id
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-fg-muted hover:text-fg hover:bg-bg-input'
                }`}
              >
                {tab === t.id && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-accent" />}
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'general' && <GeneralPanel />}
            {tab === 'providers' && <ProvidersPanel />}
            {tab === 'projects' && <ProjectsPanel />}
            {tab === 'mcp' && <McpPanel />}
            {tab === 'discover' && <DiscoverPanel />}
            {tab === 'skills' && <SkillsPanel />}
            {tab === 'prompts' && <PromptsPanel />}
            {tab === 'tools' && <ToolsPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
