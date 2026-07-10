import { useEffect } from 'react';
import { useAppStore } from '../stores/app';

export function useKeyboardShortcuts(): void {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleVision = useAppStore((s) => s.toggleVision);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const toggleCodeTab = useAppStore((s) => s.toggleCodeTab);
  const createConversation = useAppStore((s) => s.createConversation);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const abortChat = useAppStore((s) => s.abortChat);
  const toggleShortcuts = useAppStore((s) => s.toggleShortcuts);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const meta = e.ctrlKey || e.metaKey;

      // Is the user typing in a field? Text shortcuts like "?" must not fire there.
      const target = e.target as HTMLElement | null;
      const typing = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );

      if (e.key === 'F11') {
        e.preventDefault();
        void window.hive.winToggleFullscreen();
        return;
      }

      if (e.key === 'Escape') {
        // Close the cheatsheet first, then fall through to abort streaming.
        if (useAppStore.getState().shortcutsOpen) { e.preventDefault(); setShortcutsOpen(false); return; }
        if (isStreaming) { e.preventDefault(); void abortChat(); return; }
      }

      // "?" (Shift+/) toggles the shortcuts cheatsheet when not typing.
      if (!meta && !typing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        toggleShortcuts();
        return;
      }

      if (meta && !e.shiftKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); toggleVision(); }
      if (meta && e.shiftKey && (e.key === 'R' || e.key === 'r')) { e.preventDefault(); toggleRightSidebar(); }
      if (meta && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); toggleCodeTab(); }
      if (meta && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); useAppStore.getState().setSearchDialogOpen(true); }
      if (meta && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); void createConversation(); }
      if (meta && !e.shiftKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); void createConversation(); }
      if (meta && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); (document.querySelector('input[placeholder*="Search"]') as HTMLInputElement)?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebar, toggleVision, toggleRightSidebar, toggleCodeTab, createConversation, setSettingsOpen, isStreaming, abortChat, toggleShortcuts, setShortcutsOpen]);
}