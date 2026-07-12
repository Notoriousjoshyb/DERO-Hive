import { useState } from 'react';
import { GitPanel } from './GitPanel';
import { FilesPanel } from './FilesPanel';
import { ContextPanel } from './ContextPanel';
import { UsagePanel } from './UsagePanel';
import { ActivityPanel } from './ActivityPanel';

type Tab = 'activity' | 'git' | 'files' | 'context' | 'usage';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'activity', label: 'Activity' },
  { id: 'git', label: 'Git' },
  { id: 'files', label: 'Files' },
  { id: 'context', label: 'Context' },
  { id: 'usage', label: 'Usage' }
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function RightSidebar({ isOpen, onClose }: Props): JSX.Element | null {
  const [tab, setTab] = useState<Tab>('activity');

  if (!isOpen) return null;

  return (
    <aside className="w-72 bg-bg-sidebar border-l border-border flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-w-0 px-1.5 py-1.5 text-[11px] rounded-md transition truncate ${tab === t.id ? 'bg-bg-elev text-fg font-medium' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
        <button onClick={onClose} className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-fg-subtle hover:text-fg hover:bg-bg-elev rounded-md transition" title="Close sidebar">×</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'activity' && <ActivityPanel />}
        {tab === 'git' && <GitPanel />}
        {tab === 'files' && <FilesPanel />}
        {tab === 'context' && <ContextPanel />}
        {tab === 'usage' && <UsagePanel />}
      </div>
    </aside>
  );
}
