import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { PromptTemplate } from '@shared/types';

// Prompt Library — reusable prompt templates, grouped by category. Insert in
// the composer by typing "#" then the title. {{clipboard}} and {{date}}
// interpolate when a prompt is inserted.
export function PromptsPanel(): JSX.Element {
  const prompts = useAppStore((s) => s.prompts);
  const loadPrompts = useAppStore((s) => s.loadPrompts);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);

  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  const grouped = useMemo(() => {
    const map = new Map<string, PromptTemplate[]>();
    for (const p of prompts) {
      const key = p.category?.trim() || 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries());
  }, [prompts]);

  const remove = async (id: string): Promise<void> => {
    await window.hive.promptDelete(id);
    await loadPrompts();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Prompt library</h3>
          <p className="text-xs text-fg-muted mt-1">
            Reusable prompt templates. Type <code className="bg-bg-sidebar border border-border px-1 py-0.5 rounded font-mono">#</code> in
            the composer to insert one. <code className="bg-bg-sidebar border border-border px-1 py-0.5 rounded font-mono">{'{{clipboard}}'}</code> and{' '}
            <code className="bg-bg-sidebar border border-border px-1 py-0.5 rounded font-mono">{'{{date}}'}</code> fill in when inserted.
          </p>
        </div>
        <button
          onClick={() => setEditing({ id: '', title: '', content: '', createdAt: 0, updatedAt: 0 })}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
          New prompt
        </button>
      </div>

      {prompts.length === 0 ? (
        <div className="text-sm text-fg-muted p-5 bg-bg-elev/50 border border-border rounded-xl">
          No prompts yet. Save patterns you reuse — bug-report templates, explanation styles, writing personas.
        </div>
      ) : (
        grouped.map(([category, items]) => (
          <div key={category}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">{category}</div>
            <div className="space-y-2">
              {items.map((p) => (
                <div key={p.id} className="group p-3.5 bg-bg-elev/50 border border-border rounded-xl hover:border-border-strong transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-fg text-sm">{p.title}</div>
                      <div className="text-xs text-fg-subtle mt-1 line-clamp-2 whitespace-pre-wrap">{p.content}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => setEditing(p)}
                        className="px-2.5 py-1 rounded-lg border border-border bg-bg-input hover:bg-bg-elev text-fg text-xs transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void remove(p.id)}
                        className="px-2.5 py-1 rounded-lg border border-border bg-bg-input hover:bg-danger/10 hover:border-danger/40 hover:text-danger text-fg text-xs transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editing && (
        <PromptEditor
          prompt={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void loadPrompts(); }}
        />
      )}
    </div>
  );
}

function PromptEditor({ prompt, onClose, onSaved }: {
  prompt: PromptTemplate;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [title, setTitle] = useState(prompt.title);
  const [category, setCategory] = useState(prompt.category || '');
  const [content, setContent] = useState(prompt.content);

  const save = async (): Promise<void> => {
    await window.hive.promptSave({
      ...prompt,
      id: prompt.id || crypto.randomUUID(),
      title: title.trim(),
      category: category.trim() || undefined,
      content
    });
    onSaved();
  };

  const canSave = title.trim().length > 0 && content.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-bg-elev border border-border rounded-2xl shadow-elev-lg max-w-lg w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold tracking-tight">{prompt.id ? 'Edit prompt' : 'New prompt'}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-input transition" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-3.5">
          <div>
            <div className="text-xs font-medium text-fg-muted mb-1.5">Title</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bug report analysis"
              autoFocus
              className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-fg-muted mb-1.5">Category <span className="text-fg-subtle font-normal">(optional)</span></div>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="debugging"
              className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-fg-muted mb-1.5">Prompt</div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={'Analyse this error:\n\n{{clipboard}}\n\nExplain the root cause and suggest a fix.'}
              rows={8}
              className="w-full resize-y px-3 py-2 bg-bg-input border border-border rounded-lg text-xs font-mono text-fg leading-relaxed placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
            />
            <div className="text-[10px] text-fg-subtle mt-1">
              Variables: <code className="font-mono">{'{{clipboard}}'}</code> pastes your clipboard, <code className="font-mono">{'{{date}}'}</code> inserts today's date.
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-border bg-bg-input hover:bg-bg-elev text-fg text-sm transition">Cancel</button>
          <button
            onClick={() => void save()}
            disabled={!canSave}
            className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
