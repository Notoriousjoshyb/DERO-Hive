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

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault();
        void abortChat();
        return;
      }
      if (meta && !e.shiftKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); toggleVision(); }
      if (meta && e.shiftKey && (e.key === 'R' || e.key === 'r')) { e.preventDefault(); toggleRightSidebar(); }
      if (meta && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); toggleCodeTab(); }
      if (meta && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); void createConversation(); }
      if (meta && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); (document.querySelector('input[placeholder*="Search"]') as HTMLInputElement)?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebar, toggleVision, toggleRightSidebar, toggleCodeTab, createConversation, setSettingsOpen, isStreaming, abortChat]);
}