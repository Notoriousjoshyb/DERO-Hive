import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  action: () => void | Promise<void>;
}

export function CommandPalette(): JSX.Element | null {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useAppStore((s) => s.closeCommandPalette);
  const conversations = useAppStore((s) => s.conversations);
  const skills = useAppStore((s) => s.skills);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const createConversation = useAppStore((s) => s.createConversation);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const toggleVision = useAppStore((s) => s.toggleVision);
  const toggleCodeTab = useAppStore((s) => s.toggleCodeTab);
  const setSearchDialogOpen = useAppStore((s) => s.setSearchDialogOpen);
  const toggleShortcuts = useAppStore((s) => s.toggleShortcuts);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'new-conv', title: 'New conversation', subtitle: 'Start a new chat', icon: '💬', action: () => void createConversation() },
      { id: 'toggle-sidebar', title: 'Toggle sidebar', subtitle: 'Show/hide left sidebar', icon: '◫', action: toggleSidebar },
      { id: 'toggle-rightbar', title: 'Toggle right sidebar', subtitle: 'Show/hide right sidebar', icon: '◧', action: toggleRightSidebar },
      { id: 'toggle-vision', title: 'Toggle Vision', subtitle: 'Open Vision workspace', icon: '👁', action: toggleVision },
      { id: 'toggle-code', title: 'Toggle Code tab', subtitle: 'Open code editor tab', icon: '⚡', action: toggleCodeTab },
      { id: 'search', title: 'Search conversations', subtitle: 'Full-text search', icon: '🔍', action: () => setSearchDialogOpen(true) },
      { id: 'ask-data', title: 'Ask about your data', subtitle: 'Query your conversations DB naturally', icon: '🗄', action: () => {
        const input = document.querySelector('textarea[aria-label="Message input"]') as HTMLTextAreaElement | null;
        if (input) { input.value = '/ask '; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true })); }
      } },
      { id: 'settings', title: 'Settings', subtitle: 'Open settings', icon: '⚙', action: () => setSettingsOpen(true) },
      { id: 'shortcuts', title: 'Keyboard shortcuts', subtitle: 'Show shortcut help', icon: '?', action: toggleShortcuts },
    ];
    for (const c of conversations) {
      list.push({
        id: `conv-${c.id}`,
        title: c.title || 'Untitled',
        subtitle: 'Open conversation',
        icon: '💬',
        action: () => void selectConversation(c.id)
      });
    }
    for (const s of skills) {
      list.push({
        id: `skill-${s.id}`,
        title: `Skill: ${s.name}`,
        subtitle: s.description || s.slashCommand,
        icon: '⚡',
        action: () => {
          // Insert skill slash command into composer and focus it
          const input = document.querySelector('textarea[aria-label="Message input"]') as HTMLTextAreaElement | null;
          if (input) {
            input.value = `${s.slashCommand} `;
            input.focus();
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });
    }
    return list;
  }, [conversations, createConversation, selectConversation, setSearchDialogOpen, setSettingsOpen, skills, toggleCodeTab, toggleRightSidebar, toggleShortcuts, toggleSidebar, toggleVision]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((i) => i.title.toLowerCase().includes(q) || (i.subtitle?.toLowerCase().includes(q) ?? false))
      .slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) { closeCommandPalette(); void item.action(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeCommandPalette, filtered, selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-32" onClick={closeCommandPalette}>
      <div className="bg-bg-elev border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
          <span className="text-fg-subtle">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, conversations, skills…"
            className="flex-1 bg-transparent text-sm text-fg placeholder-fg-subtle outline-none"
          />
        </div>
        <div className="max-h-[60vh] overflow-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-fg-subtle">No commands found</div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => { closeCommandPalette(); void item.action(); }}
                onMouseMove={() => setSelectedIndex(idx)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 text-sm ${
                  idx === selectedIndex ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-bg-input'
                }`}
              >
                <span className="w-5 text-center">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{item.title}</div>
                  {item.subtitle && <div className="text-xs text-fg-subtle truncate">{item.subtitle}</div>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
