import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app';

// Per-conversation system prompt editor. Layered on top of the global/default
// system prompt at send time (see main/ipc/chat.ts) — leave blank to inherit.
export function SystemPromptModal(): JSX.Element | null {
  const convId = useAppStore((s) => s.systemPromptEditorConvId);
  const close = useAppStore((s) => s.closeSystemPromptEditor);
  const updateConversation = useAppStore((s) => s.updateConversation);
  const conversations = useAppStore((s) => s.conversations);

  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const conv = conversations.find((c) => c.id === convId);

  // Load the freshest system prompt straight from the DB when opened — the
  // conversation list rows carry it, but a fetch guarantees we edit current text.
  useEffect(() => {
    if (!convId) return;
    let cancelled = false;
    setLoading(true);
    void window.hive.convGet(convId).then((data) => {
      if (cancelled) return;
      setValue(data?.systemPrompt || '');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [convId]);

  useEffect(() => {
    if (!convId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [convId, close]);

  if (!convId) return null;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      // Store trimmed text; empty string clears it back to inheriting defaults.
      const trimmed = value.trim();
      await updateConversation(convId, { systemPrompt: trimmed || undefined });
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-bg-elev border border-border rounded-2xl shadow-elev-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">System prompt</h2>
            <p className="text-[11px] text-fg-subtle truncate">{conv?.title || 'Conversation'}</p>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-input transition"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <p className="text-[11px] text-fg-subtle mb-2">
            Custom instructions for this conversation. Layered on top of the default
            system prompt — leave blank to inherit the default.
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={loading}
            placeholder="You are a senior React engineer. Prefer concise answers and idiomatic TypeScript…"
            autoFocus
            rows={9}
            className="w-full resize-y bg-bg-input border border-border rounded-lg px-3 py-2 text-xs text-fg leading-relaxed placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition disabled:opacity-50"
          />
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <button
            onClick={() => setValue('')}
            disabled={loading || saving || !value}
            className="text-[11px] text-fg-subtle hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Clear
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={close}
              className="px-3 py-1.5 rounded-md text-xs text-fg-muted hover:text-fg hover:bg-bg-input transition"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={loading || saving}
              className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
