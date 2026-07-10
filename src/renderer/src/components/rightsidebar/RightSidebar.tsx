import { useState } from 'react';
import { GitPanel } from './GitPanel';
import { FilesPanel } from './FilesPanel';
import { ContextPanel } from './ContextPanel';
import { UsagePanel } from './UsagePanel';

type Tab = 'git' | 'files' | 'context' | 'usage';

const TABS: Array<{ id: Tab; label: string }> = [
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
  const [tab, setTab] = useState<Tab>('git');

  if (!isOpen) return null;

  return (
    <aside className="w-72 bg-bg-sidebar border-l border-border flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs rounded-md transition ${tab === t.id ? 'bg-bg-elev text-fg font-medium' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="text-fg-subtle hover:text-fg text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'git' && <GitPanel />}
        {tab === 'files' && <FilesPanel />}
        {tab === 'context' && <ContextPanel />}
        {tab === 'usage' && <UsagePanel />}
      </div>
    </aside>
  );
}
