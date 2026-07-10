import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';
import { BUILTIN_AGENTS } from '@shared/agents';
import type { AgentDefinition } from '@shared/types';

// Manage custom composer agents (persona presets). Built-ins are shown
// read-only; custom agents persist in AppSettings.customAgents.
export function AgentsModal(): JSX.Element | null {
  const open = useAppStore((s) => s.agentsEditorOpen);
  const setOpen = useAppStore((s) => s.setAgentsEditorOpen);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const composerAgent = useAppStore((s) => s.composerAgent);
  const setComposerAgent = useAppStore((s) => s.setComposerAgent);

  // null = list view; '' = creating new; otherwise editing that agent id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');

  const customAgents = settings.customAgents || [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editingId !== null) setEditingId(null);
        else setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editingId, setOpen]);

  if (!open) return null;

  const startCreate = (): void => {
    setDraftName('');
    setDraftDescription('');
    setDraftPrompt('');
    setEditingId('');
  };

  const startEdit = (a: AgentDefinition): void => {
    setDraftName(a.name);
    setDraftDescription(a.description || '');
    setDraftPrompt(a.prompt);
    setEditingId(a.id);
  };

  const saveDraft = async (): Promise<void> => {
    const name = draftName.trim();
    const prompt = draftPrompt.trim();
    if (!name || !prompt) return;
    const description = draftDescription.trim() || undefined;
    let next: AgentDefinition[];
    if (editingId) {
      next = customAgents.map((a) => (a.id === editingId ? { ...a, name, description, prompt } : a));
    } else {
      next = [...customAgents, { id: crypto.randomUUID(), name, description, prompt }];
    }
    await updateSettings({ customAgents: next });
    setEditingId(null);
  };

  const deleteAgent = async (id: string): Promise<void> => {
    await updateSettings({ customAgents: customAgents.filter((a) => a.id !== id) });
    // Don't leave the composer pointing at a deleted agent.
    if (composerAgent === id) setComposerAgent('orchestrator');
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] bg-bg-elev border border-border rounded-2xl shadow-elev-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
              <circle cx="6" cy="6" r="2" />
              <circle cx="11" cy="10" r="2" />
              <path d="M8 8l1 1" />
            </svg>
            <h2 className="text-sm font-semibold text-fg">{editingId === null ? 'Agents' : editingId ? 'Edit agent' : 'New agent'}</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-input transition"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        {editingId === null ? (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">Built-in</div>
                <div className="space-y-1">
                  {BUILTIN_AGENTS.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-bg-input/40">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-fg">{a.name}</div>
                        {a.description && <div className="text-[10px] text-fg-subtle truncate">{a.description}</div>}
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-bg border border-border text-fg-subtle">built-in</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">Custom</div>
                {customAgents.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-fg-subtle border border-dashed border-border rounded-lg">
                    No custom agents yet — create personas like “React expert” or “Tech writer”.
                  </div>
                )}
                <div className="space-y-1">
                  {customAgents.map((a) => (
                    <div key={a.id} className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 hover:border-border bg-bg-input/40 transition">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-fg">{a.name}</div>
                        <div className="text-[10px] text-fg-subtle truncate">{a.description || a.prompt.replace(/\s+/g, ' ').slice(0, 80)}</div>
                      </div>
                      <button
                        onClick={() => startEdit(a)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-fg-subtle hover:text-fg hover:bg-bg-input transition"
                        title="Edit"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
                          <path d="M8.5 2L10 3.5l-6 6H2.5v-1.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => void deleteAgent(a.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-fg-subtle hover:text-danger hover:bg-bg-input transition"
                        title="Delete"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                          <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={startCreate}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent/25 bg-accent-soft text-accent hover:border-accent/50 hover:bg-accent hover:text-white transition text-xs font-medium"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M6 2v8M2 6h8" />
                </svg>
                New agent
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">Name</label>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="React expert"
                  autoFocus
                  className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">Description <span className="normal-case font-normal">(optional)</span></label>
                <input
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="Shown in the agent picker"
                  className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">System prompt</label>
                <textarea
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  placeholder="You are a senior React engineer. Prefer function components, hooks, and idiomatic TypeScript…"
                  rows={8}
                  className="w-full resize-y bg-bg-input border border-border rounded-lg px-3 py-2 text-xs text-fg leading-relaxed placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <button
                onClick={() => setEditingId(null)}
                className="px-3 py-1.5 rounded-md text-xs text-fg-muted hover:text-fg hover:bg-bg-input transition"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveDraft()}
                disabled={!draftName.trim() || !draftPrompt.trim()}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Save agent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
