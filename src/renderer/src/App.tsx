import { useEffect } from 'react';
import { useAppStore } from './stores/app';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { CanvasPanel } from './components/CanvasPanel';
import { RightSidebar } from './components/rightsidebar/RightSidebar';
import { CodeTab } from './components/code/CodeTab';
import { SettingsModal } from './components/settings/SettingsModal';
import { PermissionDialog } from './components/PermissionDialog';
import { useChat } from './hooks/useChat';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { applyTheme, applyAppearance } from './lib/theme';

export default function App(): JSX.Element {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const canvasOpen = useAppStore((s) => s.canvasOpen);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const codeTabOpen = useAppStore((s) => s.codeTabOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleCanvas = useAppStore((s) => s.toggleCanvas);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const toggleCodeTab = useAppStore((s) => s.toggleCodeTab);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const loadProviders = useAppStore((s) => s.loadProviders);
  const loadSkills = useAppStore((s) => s.loadSkills);
  const loadMcpStatuses = useAppStore((s) => s.loadMcpStatuses);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const loadTools = useAppStore((s) => s.loadTools);
  const theme = useAppStore((s) => s.settings.theme);
  const settings = useAppStore((s) => s.settings);

  useChat();
  useKeyboardShortcuts();

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyAppearance(settings); }, [settings]);

  useEffect(() => {
    void loadSettings();
    void loadProviders();
    void loadSkills();
    void loadMcpStatuses();
    void loadConversations();
    void loadTools();

    const offMcp = window.hive.onMcpChanged(() => loadMcpStatuses());
    const offModels = window.hive.onModelsUpdated(() => loadProviders());
    const offMenu = window.hive.onMenu((action) => {
      if (action === 'new-conversation') void useAppStore.getState().createConversation();
      else if (action === 'toggle-sidebar') toggleSidebar();
      else if (action === 'toggle-canvas') toggleCanvas();
      else if (action === 'toggle-right-sidebar') toggleRightSidebar();
      else if (action === 'toggle-code-tab') toggleCodeTab();
      else if (action === 'open-settings') setSettingsOpen(true);
    });
    const offProject = window.hive.onProjectOpened((p) => {
      void useAppStore.getState().updateSettings({ workingDirectory: p });
    });
    const offTheme = window.hive.onThemeChanged((info) => {
      const cur = useAppStore.getState().settings.theme;
      if (cur === 'system') applyTheme('system', info.shouldUseDarkColors);
    });

    return () => { offMcp(); offModels(); offMenu(); offProject(); offTheme(); };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        {codeTabOpen ? <CodeTab /> : <ChatView />}
        {canvasOpen && <CanvasPanel />}
        <RightSidebar isOpen={rightSidebarOpen} onClose={toggleRightSidebar} />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <PermissionDialog />
      <style>{`
        body.focus-mode [data-sidebar-panel],
        body.focus-mode [data-canvas-panel] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}