import { useEffect } from 'react';
import { useAppStore } from './stores/app';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { VisionPanel } from './components/VisionPanel';
import { VisionTab } from './components/VisionTab';
import { HiveCompanionPanel } from './components/HiveCompanionPanel';
import { RightSidebar } from './components/rightsidebar/RightSidebar';
import { CodeTab } from './components/code/CodeTab';
import { SettingsModal } from './components/settings/SettingsModal';
import { PermissionDialog } from './components/PermissionDialog';
import { ShortcutsCheatsheet } from './components/ShortcutsCheatsheet';
import { SystemPromptModal } from './components/SystemPromptModal';
import { AgentsModal } from './components/AgentsModal';
import { SearchDialog } from './components/SearchDialog';
import { ComparePanel } from './components/ComparePanel';
import { SwarmModal } from './components/SwarmModal';
import { CommandPalette } from './components/CommandPalette';
import { AgentBar } from './components/AgentBar';
import { useChat } from './hooks/useChat';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { applyTheme, applyAppearance } from './lib/theme';

export default function App(): JSX.Element {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const visionOpen = useAppStore((s) => s.visionOpen);
  const companionOpen = useAppStore((s) => s.companionOpen);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const codeTabOpen = useAppStore((s) => s.codeTabOpen);
  const visionTabOpen = useAppStore((s) => s.visionTabOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleVision = useAppStore((s) => s.toggleVision);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const toggleCodeTab = useAppStore((s) => s.toggleCodeTab);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const loadProviders = useAppStore((s) => s.loadProviders);
  const loadSkills = useAppStore((s) => s.loadSkills);
  const loadCustomCommands = useAppStore((s) => s.loadCustomCommands);
  const loadPrompts = useAppStore((s) => s.loadPrompts);
  const loadMcpStatuses = useAppStore((s) => s.loadMcpStatuses);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const loadTools = useAppStore((s) => s.loadTools);
  const loadSwarmRuns = useAppStore((s) => s.loadSwarmRuns);
  const theme = useAppStore((s) => s.settings.theme);
  const settings = useAppStore((s) => s.settings);

  useChat();
  useKeyboardShortcuts();

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyAppearance(settings); }, [settings]);

  // Keep the browser extension's model picker in sync with the composer.
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  useEffect(() => {
    void window.hive.browserBridgeReportSelection(selectedProviderId, selectedModel);
  }, [selectedProviderId, selectedModel]);

  useEffect(() => {
    void loadSettings();
    void loadProviders();
    void loadSkills();
    void loadCustomCommands();
    void loadPrompts();
    void loadMcpStatuses();
    void loadConversations();
    void loadTools();
    void loadSwarmRuns();

    const offMcp = window.hive.onMcpChanged(() => {
      void loadMcpStatuses();
      void loadTools();
    });
    const offModels = window.hive.onModelsUpdated(() => loadProviders());
    const offMenu = window.hive.onMenu((action) => {
      if (action === 'new-conversation') void useAppStore.getState().createConversation();
      else if (action === 'toggle-sidebar') toggleSidebar();
      else if (action === 'toggle-vision' || action === 'toggle-canvas') toggleVision();
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
    const offTitle = window.hive.onConvTitleGenerated(() => {
      void loadConversations();
    });
    const offBrowserBridge = window.hive.onBrowserBridgeContext(({ detail, requestId, providerId, model }) => {
      if (providerId && model) useAppStore.getState().setSelection(providerId, model);
      window.dispatchEvent(new CustomEvent('hive:companion-compose', { detail: { text: detail, autoSend: true, requestId } }));
    });
    const offSelectModel = window.hive.onBrowserBridgeSelectModel(({ providerId, model }) => {
      const state = useAppStore.getState();
      const provider = state.providers.find((p) => p.id === providerId);
      if (provider?.models.some((m) => m.id === model)) state.setSelection(providerId, model);
    });
    const offSwarm = window.hive.onSwarmProgress(({ run }) => {
      useAppStore.getState().upsertSwarmRun(run);
    });

    return () => { offMcp(); offModels(); offMenu(); offProject(); offTheme(); offTitle(); offBrowserBridge(); offSelectModel(); offSwarm(); };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg">
      <TitleBar />
      <div className="relative flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        {codeTabOpen ? <CodeTab /> : visionTabOpen ? <VisionTab /> : <ChatView />}
        {visionOpen && <VisionPanel />}
        {companionOpen && <HiveCompanionPanel />}
        <RightSidebar isOpen={rightSidebarOpen} onClose={toggleRightSidebar} />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <PermissionDialog />
      <ShortcutsCheatsheet />
      <SystemPromptModal />
      <AgentsModal />
      <SearchDialog />
      <ComparePanel />
      <SwarmModal />
      <CommandPalette />
      <AgentBar />
      <style>{`
        body.focus-mode [data-sidebar-panel],
        body.focus-mode [data-vision-panel] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
