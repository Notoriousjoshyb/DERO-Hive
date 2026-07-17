import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/app';
import type { ProviderModel, ToolApprovalMode } from '@shared/types';
import { thinkingOptionsFor, usesDefaultThinkingOptions } from '@shared/thinkingCapabilities';
import { BUILTIN_AGENTS, resolveAgent } from '@shared/agents';
import { VoiceInput } from './VoiceInput';

interface Props {
  isStreaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onAttach: () => void;
  canSend: boolean;
  onVoiceResult: (text: string, isFinal: boolean) => void;
  onAttachGh: () => void;
  onCompare?: () => void;
  onSwarm?: () => void;
  onSchedule?: () => void;
  focusComposer?: () => void;
}

const EMPTY_FAVS: string[] = [];
export function ComposerToolbar({ isStreaming, onSend, onStop, onAttach, canSend, onVoiceResult, onAttachGh, onCompare, onSwarm, onSchedule, focusComposer }: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleFavourite = useAppStore((s) => s.toggleFavourite);
  const favourites = useAppStore((s) => s.settings.favouriteModels || EMPTY_FAVS);
  const projects = useAppStore((s) => s.projects);
  const conversations = useAppStore((s) => s.conversations);
  const currentConversationId = useAppStore((s) => s.currentConversationId);

  // Active conversation's project trust (absent config = standard). Untrusted
  // projects force a prompt for every tool call in main, so the "never ask"
  // mode is a lie there — hide it and say why.
  const activeProject = projects.find((p) => p.id === conversations.find((c) => c.id === currentConversationId)?.projectId);
  const projectUntrusted = activeProject?.config?.trust === 'untrusted';

  const planMode = useAppStore((s) => s.composerPlanMode);
  const togglePlan = useAppStore((s) => s.toggleComposerPlan);
  const reasoning = useAppStore((s) => s.composerReasoning);
  const setReasoning = useAppStore((s) => s.setComposerReasoning);
  const focusMode = useAppStore((s) => s.composerFocusMode);
  const toggleFocus = useAppStore((s) => s.toggleComposerFocus);
  const agent = useAppStore((s) => s.composerAgent);
  const setAgent = useAppStore((s) => s.setComposerAgent);
  const loadProviders = useAppStore((s) => s.loadProviders);

  const customAgents = settings.customAgents || [];
  const allAgents = [...BUILTIN_AGENTS, ...customAgents];
  const activeAgent = resolveAgent(agent, customAgents);

  const provider = providers.find((p) => p.id === selectedProviderId);
  const selectedProviderModel = provider?.models.find((model) => model.id === selectedModel);
  const thinkingOptions = thinkingOptionsFor(
    provider?.presetId,
    selectedModel,
    selectedProviderModel
  );
  const thinkingAvailable = thinkingOptions.length > 0;
  const usingDefaultThinking = usesDefaultThinkingOptions(
    provider?.presetId,
    selectedModel,
    selectedProviderModel
  );

  // A model switch can invalidate the previously selected effort. Reset the
  // composer immediately so the label and the request stay in sync.
  useEffect(() => {
    if (usingDefaultThinking && reasoning === 'off') {
      setReasoning('medium');
    } else if (reasoning !== 'off' && !thinkingOptions.some((option) => option.id === reasoning)) {
      setReasoning('off');
    }
  }, [reasoning, setReasoning, thinkingOptions, usingDefaultThinking]);

  type MenuId = 'model' | 'agent' | 'perm' | 'attach' | 'think';
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [loadingThinking, setLoadingThinking] = useState(false);
  const closeAll = (): void => setOpenMenu(null);
  // Toggle a menu: clicking the already-open trigger closes it, otherwise
  // switches to the clicked one (closing any other). Reading openMenu from the
  // current render avoids the stale double-update bug where a menu never closed.
  const toggleMenu = (menu: MenuId): void => setOpenMenu((cur) => (cur === menu ? null : menu));

  const modelMenuOpen = openMenu === 'model';
  const agentMenuOpen = openMenu === 'agent';
  const permMenuOpen = openMenu === 'perm';
  const attachMenuOpen = openMenu === 'attach';
  const thinkMenuOpen = openMenu === 'think';

  // Close menus on outside click
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const cyclePermMode = async (): Promise<void> => {
    const order: ToolApprovalMode[] = projectUntrusted ? ['always', 'session', 'project'] : ['always', 'session', 'project', 'never'];
    const cur = settings.toolApprovalMode || 'always';
    const next = order[(order.indexOf(cur) + 1) % order.length] || order[0];
    await useAppStore.getState().updateSettings({ toolApprovalMode: next });
  };

  const permLabel = settings.toolApprovalMode === 'never' ? 'No approval'
    : settings.toolApprovalMode === 'project' ? 'Ask once/project'
    : settings.toolApprovalMode === 'session' ? 'Ask once/conversation'
    : 'Always ask';

  const loadCodexThinking = async (): Promise<void> => {
    if (!selectedProviderId || provider?.presetId !== 'codex' || loadingThinking) return;
    setLoadingThinking(true);
    try {
      const result = await window.hive.providerRefreshModels(selectedProviderId);
      if (!result.ok) useAppStore.getState().setChatError(result.error || 'Could not load Codex thinking options.');
      else await loadProviders();
    } finally {
      setLoadingThinking(false);
    }
  };

  return (
    <div ref={toolbarRef} className="flex items-center justify-between flex-wrap gap-1 px-2 py-1.5 border-t border-border min-w-0">
      {/* Left side */}
      <div className="flex items-center gap-0.5 relative">
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('attach')}
            title="Add (file, GitHub issue, GitHub PR)"
            className="p-1.5 rounded hover:bg-bg-elev text-fg-muted hover:text-fg"
          >
            <PlusIcon />
          </button>
          {attachMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 menu-panel overflow-hidden min-w-44 z-50">
              <AttachMenuItem icon={<FileIcon />} label="Attach file..." shortcut="" onClick={() => { closeAll(); onAttach(); }} />
              <AttachMenuItem icon={<GitHubIcon />} label="Link GitHub issue/PR..." onClick={() => { closeAll(); onAttachGh(); }} />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggleFocus}
          title={focusMode ? 'Exit focus mode' : 'Focus mode'}
          className={`p-1.5 rounded transition ${focusMode ? 'text-accent bg-accent/10' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
        >
          <FocusIcon on={focusMode} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('perm')}
            title={projectUntrusted ? 'Tool approval (project is untrusted — every tool call asks)' : 'Tool approval'}
            className={`p-1.5 rounded transition ${settings.toolApprovalMode === 'never' || projectUntrusted ? 'text-warn bg-warn/10' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
          >
            <ShieldIcon />
          </button>
          {permMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 menu-panel overflow-hidden min-w-52 z-50">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Tool approval</div>
              {(['always', 'session', 'project', 'never'] as const)
                .filter((mode) => !(projectUntrusted && mode === 'never'))
                .map((mode) => (
                <button
                  key={mode}
                  onClick={async () => { await useAppStore.getState().updateSettings({ toolApprovalMode: mode }); closeAll(); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-bg-input ${settings.toolApprovalMode === mode ? 'text-accent' : 'text-fg'}`}
                >
                  <span>{mode === 'always' ? 'Always ask' : mode === 'session' ? 'Ask once per conversation' : mode === 'project' ? 'Ask once per project' : 'Never ask (trust all)'}</span>
                  {settings.toolApprovalMode === mode && <CheckMark />}
                </button>
              ))}
              {projectUntrusted && (
                <div className="px-3 py-1.5 text-[10px] text-warn flex items-center gap-1.5 border-t border-border/50">
                  <LockIcon />
                  <span>
                    Project is untrusted — every tool call asks.
                    {settings.toolApprovalMode === 'never' && ' "Never ask" is set, but prompts will still appear.'}
                  </span>
                </div>
              )}
              <button
                onClick={async () => { await cyclePermMode(); closeAll(); }}
                className="w-full text-left px-3 py-1.5 text-[10px] text-fg-subtle hover:bg-bg-input border-t border-border/50"
              >
                Cycle (current: {permLabel}) →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-0.5 flex-wrap justify-end min-w-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('agent')}
            title={activeAgent.description || 'Agent'}
            className="px-2 py-1 rounded text-[11px] hover:bg-bg-elev text-fg-muted hover:text-fg flex items-center gap-1 max-w-32"
          >
            <AgentIcon />
            <span className="truncate">{activeAgent.name}</span>
            <ChevronIcon />
          </button>
          {agentMenuOpen && (
            <div className="absolute bottom-full right-0 mb-1 menu-panel overflow-hidden min-w-48 max-h-72 overflow-y-auto z-50">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Agent</div>
              {allAgents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setAgent(a.id); closeAll(); }}
                  title={a.description || a.prompt.slice(0, 120)}
                  className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-bg-input ${agent === a.id ? 'text-accent' : 'text-fg'}`}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-xs truncate">{a.name}</span>
                    {a.description && <span className="text-[10px] text-fg-subtle truncate">{a.description}</span>}
                  </span>
                  {agent === a.id && <CheckMark />}
                </button>
              ))}
              <button
                onClick={() => { useAppStore.getState().setAgentsEditorOpen(true); closeAll(); }}
                className="w-full text-left px-3 py-2 text-[11px] text-fg-subtle hover:text-fg hover:bg-bg-input border-t border-border/50"
              >
                Manage agents…
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('model')}
            title="Model"
            className="px-2 py-1 rounded text-[11px] hover:bg-bg-elev text-fg-muted hover:text-fg flex items-center gap-1 max-w-44"
          >
            <ModelIcon />
            <span className="truncate">{selectedModel || 'no model'}</span>
            <ChevronIcon />
          </button>
          {modelMenuOpen && providers.length > 0 && (
            <div className="absolute bottom-full right-0 mb-1 menu-panel overflow-hidden min-w-64 max-h-72 overflow-y-auto z-50">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Provider</div>
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelection(p.id, p.models[0]?.id); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-bg-input ${selectedProviderId === p.id ? 'text-accent' : 'text-fg'}`}
                >
                  <span className="truncate">{p.name}</span>
                  {selectedProviderId === p.id && <CheckMark />}
                </button>
              ))}
              {provider && provider.models.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-subtle border-t border-b border-border/50">Model</div>
                  {provider.models
                    .slice()
                    .sort((a: ProviderModel, b: ProviderModel) => {
                      const fa = favourites.includes(`${provider.id}:${a.id}`) ? 1 : 0;
                      const fb = favourites.includes(`${provider.id}:${b.id}`) ? 1 : 0;
                      return fb - fa;
                    })
                    .map((m) => {
                      const isFav = favourites.includes(`${provider.id}:${m.id}`);
                      return (
                        <div
                          key={m.id}
                          className={`flex items-center px-3 py-1 hover:bg-bg-input ${selectedModel === m.id ? 'text-accent' : 'text-fg'}`}
                        >
                          <button
                            onClick={() => { setSelection(selectedProviderId, m.id); closeAll(); focusComposer?.(); }}
                            className="flex-1 text-left text-xs truncate"
                            title={m.id}
                          >
                            {isFav ? '★ ' : ''}{m.name}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectedProviderId) toggleFavourite(selectedProviderId, m.id);
                            }}
                            title={isFav ? 'Unfavourite' : 'Favourite'}
                            className={`text-[10px] px-1 ${isFav ? 'text-warn' : 'text-fg-subtle hover:text-warn'}`}
                          >
                            {isFav ? '★' : '☆'}
                          </button>
                        </div>
                      );
                    })}
                </>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (thinkingAvailable) toggleMenu('think');
              else void loadCodexThinking();
            }}
            disabled={!thinkingAvailable && provider?.presetId !== 'codex'}
            title={thinkingAvailable ? `Thinking effort: ${reasoning}` : provider?.presetId === 'codex' ? 'Load exact thinking options for this Codex account and model' : 'Thinking is not available for this model'}
            className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 transition ${
              !thinkingAvailable && provider?.presetId !== 'codex' ? 'text-fg-subtle cursor-not-allowed opacity-60'
              : !thinkingAvailable ? 'text-accent hover:bg-accent/10'
              : reasoning === 'off' ? 'text-fg-muted hover:text-fg hover:bg-bg-elev'
              : reasoning === 'low' ? 'text-success bg-success/10 hover:bg-success/20'
              : reasoning === 'medium' ? 'text-accent bg-accent/10 hover:bg-accent/20'
              : 'text-warn bg-warn/10 hover:bg-warn/20'
            }`}
            >
            <BrainIcon />
            <span className="capitalize">{thinkingAvailable ? reasoning === 'off' ? 'Think' : reasoning : loadingThinking ? 'Loading…' : provider?.presetId === 'codex' ? 'Load thinking' : 'No thinking'}</span>
            <ChevronIcon />
          </button>
          {thinkMenuOpen && (
            <div className="absolute bottom-full right-0 mb-1 menu-panel overflow-hidden min-w-44 z-50">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Thinking effort</div>
              {([
                { id: 'off', label: 'Default', desc: 'Use the model and provider default' },
                ...thinkingOptions.map((opt) => ({ ...opt, desc: opt.description }))
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => { setReasoning(opt.id); closeAll(); }}
                  className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-bg-input ${reasoning === opt.id ? 'text-accent' : 'text-fg'}`}
                >
                  <span className="flex flex-col">
                    <span className="text-xs">{opt.label}</span>
                    <span className="text-[10px] text-fg-subtle">{opt.desc}</span>
                  </span>
                  {reasoning === opt.id && <CheckMark />}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={togglePlan}
          title={planMode ? 'Plan mode on: ask before acting' : 'Build mode: act directly'}
          className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 transition ${planMode ? 'text-success bg-success/15' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
        >
          <LeafIcon />
          <span>{planMode ? 'Plan' : 'Build'}</span>
        </button>

        <VoiceInput onResult={onVoiceResult} />

        {onCompare && (
          <button
            type="button"
            onClick={onCompare}
            title="Compare two models side-by-side"
            className="px-2 py-1 rounded text-[11px] flex items-center gap-1 text-fg-muted hover:text-fg hover:bg-bg-elev transition"
          >
            <SplitIcon />
            <span>Compare</span>
          </button>
        )}

        {onSwarm && (
          <button
            type="button"
            onClick={onSwarm}
            disabled={isStreaming}
            title="Launch parallel specialist agents for this task"
            className="px-2 py-1 rounded text-[11px] flex items-center gap-1 text-fg-muted hover:text-fg hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <SwarmIcon />
            <span>Swarm</span>
          </button>
        )}

        {onSchedule && (
          <button
            type="button"
            onClick={onSchedule}
            title="Schedule message"
            className="px-2 py-1 rounded text-[11px] flex items-center gap-1 text-fg-muted hover:text-fg hover:bg-bg-elev transition"
          >
            <ClockIcon />
            <span>Schedule</span>
          </button>
        )}

        <button
          type="button"
          onClick={isStreaming ? onStop : onSend}
          disabled={!isStreaming && !canSend}
          title={isStreaming ? 'Stop generating' : 'Send message (Enter)'}
          className={`ml-1 w-7 h-7 rounded-full transition-all duration-150 flex items-center justify-center flex-shrink-0 ${
            isStreaming
              ? 'bg-danger/10 text-danger hover:bg-danger hover:text-white'
              : canSend
              ? 'bg-accent text-white hover:bg-accent-hover shadow-elev-sm scale-100'
              : 'bg-bg-elev text-fg-subtle/50 cursor-not-allowed'
          }`}
        >
          {isStreaming ? <StopIcon /> : <SendIcon />}
        </button>
      </div>
    </div>
  );
}

function AttachMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; shortcut?: string; onClick: () => void }): JSX.Element {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-2 text-xs text-fg hover:bg-bg-input flex items-center gap-2 transition-colors">
      <span className="text-fg-subtle flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

function CheckMark(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6.5L4.5 9 10 3.5" />
    </svg>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M3.5 1.5h5L11 4v8.5h-7.5z" />
      <path d="M8.5 1.5V4H11" />
    </svg>
  );
}

function GitHubIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v6M5 8h6" /></svg>;
}
function FocusIcon({ on }: { on: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 2H3a1 1 0 00-1 1v2M11 2h2a1 1 0 011 1v2M5 14H3a1 1 0 01-1-1v-2M11 14h2a1 1 0 001-1v-2" />
      {on && <circle cx="8" cy="8" r="2" fill="currentColor" />}
    </svg>
  );
}
function ShieldIcon(): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2z" /></svg>;
}
function LockIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-shrink-0"><rect x="3.5" y="7" width="9" height="6" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>;
}
function AgentIcon(): JSX.Element {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="2" /><circle cx="11" cy="10" r="2" /><path d="M8 8l1 1" /></svg>;
}
function ModelIcon(): JSX.Element {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M2 7h12" /></svg>;
}
function BrainIcon(): JSX.Element {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2a3 3 0 00-3 3v1a3 3 0 00-1 5 3 3 0 003 3 2 2 0 002 2 2 2 0 002-2V4a2 2 0 00-2-2 2 2 0 00-1 .4zM10 2a3 3 0 013 3v1a3 3 0 011 5 3 3 0 01-3 3 2 2 0 01-2 2 2 2 0 01-2-2V4a2 2 0 012-2 2 2 0 011 .4z" /></svg>;
}
function LeafIcon(): JSX.Element {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 13c0-6 4-10 10-10-1 5-4 9-10 10zM3 13l5-5" /></svg>;
}
function ChevronIcon(): JSX.Element {
  return <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6l4 4 4-4" /></svg>;
}
function StopIcon(): JSX.Element {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>;
}
function SplitIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v14" />
      <path d="M4 4h4M4 8h4M4 12h4" />
      <path d="M12 4h2M12 8h2M12 12h2" />
    </svg>
  );
}

function SwarmIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="5" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M5.7 6.1l1.2 3.4M10.3 6.1L9.1 9.5M6 5h4" />
    </svg>
  );
}
function ClockIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v3.5l2.5 2.5" />
    </svg>
  );
}
function SendIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  );
}
