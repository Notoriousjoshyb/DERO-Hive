import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import type { SearchResult } from '@shared/types';

// Full-text search over all conversations (Ctrl+Shift+F), backed by the
// SQLite FTS5 index via convSearch. Results are grouped per conversation;
// clicking one opens the conversation and scrolls to the matched message.
export function SearchDialog(): JSX.Element | null {
  const open = useAppStore((s) => s.searchDialogOpen);
  const setOpen = useAppStore((s) => s.setSearchDialogOpen);
  const conversations = useAppStore((s) => s.conversations);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const setPendingScrollMessageId = useAppStore((s) => s.setPendingScrollMessageId);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced FTS query
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await window.hive.convSearch(query);
        setResults(r || []);
        setActiveIndex(0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const titleFor = useMemo(() => {
    const map = new Map(conversations.map((c) => [c.id, c.title]));
    return (id: string): string => map.get(id) || 'Archived chat';
  }, [conversations]);

  // Group consecutive results by conversation, preserving rank order.
  const grouped = useMemo(() => {
    const groups: Array<{ conversationId: string; items: Array<SearchResult & { flatIndex: number }> }> = [];
    results.forEach((r, i) => {
      const last = groups[groups.length - 1];
      const item = { ...r, flatIndex: i };
      if (last && last.conversationId === r.conversationId) last.items.push(item);
      else groups.push({ conversationId: r.conversationId, items: [item] });
    });
    return groups;
  }, [results]);

  if (!open) return null;

  const openResult = async (r: SearchResult): Promise<void> => {
    setOpen(false);
    // Land in the chat view — leave any full-view tab occupying the main column.
    const s = useAppStore.getState();
    if (s.codeTabOpen) s.toggleCodeTab();
    else if (s.visionTabOpen) s.toggleVisionTab();
    setPendingScrollMessageId(r.messageId);
    await selectConversation(r.conversationId);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIndex];
      if (r) void openResult(r);
    }
  };

  const scrollActiveIntoView = (): void => {
    // Deferred a frame so it runs after React re-renders the new active row.
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector('[data-active="true"]');
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-6 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-bg-elev border border-border rounded-2xl shadow-elev-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fg-subtle flex-shrink-0">
            <circle cx="6" cy="6" r="4" />
            <path d="M11 11l-2.5-2.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search all conversations…"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
          />
          {searching && (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-fg-subtle animate-spin">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            </svg>
          )}
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-bg-input text-[9px] font-mono text-fg-subtle">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
          {query.trim() && !searching && results.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-fg-subtle">No matches for “{query}”</div>
          )}
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-xs text-fg-subtle">
              Type to search message content across every conversation.
              <div className="mt-2 text-[10px]">↑↓ to navigate · Enter to open</div>
            </div>
          )}
          {grouped.map((g) => (
            <div key={`${g.conversationId}-${g.items[0].flatIndex}`}>
              <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle truncate">
                {titleFor(g.conversationId)}
              </div>
              {g.items.map((r) => (
                <button
                  key={r.messageId}
                  data-active={r.flatIndex === activeIndex}
                  onClick={() => void openResult(r)}
                  onMouseEnter={() => setActiveIndex(r.flatIndex)}
                  className={`w-full text-left px-4 py-2 flex items-start gap-2.5 transition-colors ${
                    r.flatIndex === activeIndex ? 'bg-bg-input' : 'hover:bg-bg-input/60'
                  }`}
                >
                  <span className={`mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                    r.role === 'user' ? 'text-accent border-accent/30 bg-accent/10' : 'text-fg-subtle border-border bg-bg'
                  }`}>
                    {r.role === 'user' ? 'You' : r.role === 'assistant' ? 'AI' : r.role}
                  </span>
                  <span className="text-xs text-fg-muted leading-relaxed line-clamp-2">
                    <Snippet text={r.snippet} />
                  </span>
                </button>
              ))}
            </div>
          ))}
          {results.length > 0 && <div className="h-2" />}
        </div>
      </div>
    </div>
  );
}

// FTS5 snippet() wraps matches in <mark>…</mark>. Render those as highlights
// without dangerouslySetInnerHTML — split on the tags and style the pieces.
function Snippet({ text }: { text: string }): JSX.Element {
  const parts = text.split(/<mark>|<\/mark>/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-accent/25 text-fg rounded-[2px] px-px">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}
