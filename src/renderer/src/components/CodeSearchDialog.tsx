import { useEffect, useRef, useState } from 'react';

interface CodeSearchResult {
  path: string;
  filename: string;
  preview: string;
  line: number;
}

export function CodeSearchDialog(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await window.hive.fsSearchCode({ query, limit: 20 });
        setResults(r || []);
        setActiveIndex(0);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  // Focus input on open
  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setActiveIndex(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) {
        const r = results[activeIndex];
        // Insert into composer via a custom event
        window.dispatchEvent(new CustomEvent('insert-search-result', { detail: r }));
        setOpen(false);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-24" onClick={() => setOpen(false)}>
      <div className="bg-bg-elev border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-fg-subtle text-sm">Ctrl+Shift+F</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search code in workspace… (↑↓ navigate, Enter insert, Esc close)"
            className="flex-1 bg-transparent text-sm text-fg placeholder-fg-subtle outline-none"
          />
          {searching && <span className="text-fg-subtle text-xs animate-pulse">searching…</span>}
        </div>
        <div className="max-h-[60vh] overflow-auto py-2">
          {results.length === 0 && !searching && query.trim() && (
            <div className="px-4 py-6 text-center text-sm text-fg-subtle">No code matches "{query}"</div>
          )}
          {results.map((r, i) => (
            <div
              key={`${r.path}:${r.line}`}
              onClick={() => { window.dispatchEvent(new CustomEvent('insert-search-result', { detail: r })); setOpen(false); }}
              className={`px-4 py-2 cursor-pointer ${i === activeIndex ? 'bg-bg-hover' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-accent font-mono text-xs font-medium">{r.filename}</span>
                <span className="text-fg-subtle text-xs">line {r.line}</span>
                <span className="text-fg-subtle text-xs truncate">{r.path.replace(process.cwd(), '.')}</span>
              </div>
              <pre className="text-xs text-fg-muted font-mono whitespace-pre-wrap break-all leading-relaxed">{r.preview}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
