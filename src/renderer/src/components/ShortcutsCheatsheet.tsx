import { useEffect } from 'react';
import { useAppStore } from '../stores/app';

interface Shortcut {
  keys: string[];
  label: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

// Show the platform-appropriate modifier glyph. macOS uses ⌘, everyone else Ctrl.
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const GROUPS: Group[] = [
  {
    title: 'General',
    items: [
      { keys: [MOD, 'N'], label: 'New chat' },
      { keys: [MOD, 'Shift', 'O'], label: 'New chat' },
      { keys: [MOD, ','], label: 'Open settings' },
      { keys: [MOD, 'K'], label: 'Focus sidebar search' },
      { keys: [MOD, 'Shift', 'F'], label: 'Search all conversations' },
      { keys: ['?'], label: 'Show this cheatsheet' },
      { keys: ['Esc'], label: 'Stop response / close overlay' }
    ]
  },
  {
    title: 'Layout',
    items: [
      { keys: ['F11'], label: 'Toggle full screen' },
      { keys: [MOD, 'B'], label: 'Toggle sidebar' },
      { keys: [MOD, 'Shift', 'E'], label: 'Toggle Code tab' },
      { keys: [MOD, 'Shift', 'C'], label: 'Toggle Vision panel' },
      { keys: [MOD, 'Shift', 'R'], label: 'Toggle right sidebar' }
    ]
  },
  {
    title: 'Composer',
    items: [
      { keys: ['Enter'], label: 'Send message' },
      { keys: ['Shift', 'Enter'], label: 'New line' },
      { keys: ['/'], label: 'Slash command (skill)' },
      { keys: ['!'], label: 'Run shell command' }
    ]
  }
];

export function ShortcutsCheatsheet(): JSX.Element | null {
  const open = useAppStore((s) => s.shortcutsOpen);
  const setOpen = useAppStore((s) => s.setShortcutsOpen);

  // Lock body scroll while the overlay is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-bg-elev border border-border rounded-2xl shadow-elev-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border sticky top-0 bg-bg-elev z-10">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-accent">
              <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
              <path d="M4 7h.01M6 7h.01M8 7h.01M10 7h.01M4 9.5h6" strokeLinecap="round" />
            </svg>
            <h2 className="text-sm font-semibold text-fg">Keyboard Shortcuts</h2>
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

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">
                {group.title}
              </div>
              <div className="space-y-1.5">
                {group.items.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-fg-muted">{s.label}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="px-1.5 py-0.5 min-w-[20px] text-center rounded border border-border bg-bg-input text-[10px] font-mono text-fg-muted shadow-elev-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-border text-[10px] text-fg-subtle">
          Press <kbd className="px-1 py-0.5 rounded border border-border bg-bg-input font-mono">?</kbd> anytime to open this list.
        </div>
      </div>
    </div>
  );
}
