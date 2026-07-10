import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/app';
import type { ProviderModel } from '@shared/types';
import { VoiceInput } from './VoiceInput';

interface Props {
  isStreaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onAttach: () => void;
  canSend: boolean;
  onVoiceResult: (text: string, isFinal: boolean) => void;
  onAttachGh: () => void;
  focusComposer?: () => void;
}

const EMPTY_FAVS: string[] = [];

export function ComposerToolbar({ isStreaming, onSend, onStop, onAttach, canSend, onVoiceResult, onAttachGh, focusComposer }: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const selectedProviderId = useAppStore((s) => s.selectedProviderId);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleFavourite = useAppStore((s) => s.toggleFavourite);
  const favourites = useAppStore((s) => s.settings.favouriteModels || EMPTY_FAVS);

  const planMode = useAppStore((s) => s.composerPlanMode);
  const togglePlan = useAppStore((s) => s.toggleComposerPlan);
  const reasoning = useAppStore((s) => s.composerReasoning);
  const setReasoning = useAppStore((s) => s.setComposerReasoning);
  const focusMode = useAppStore((s) => s.composerFocusMode);
  const toggleFocus = useAppStore((s) => s.toggleComposerFocus);
  const agent = useAppStore((s) => s.composerAgent);
  const setAgent = useAppStore((s) => s.setComposerAgent);

  const provider = providers.find((p) => p.id === selectedProviderId);

  type MenuId = 'model' | 'agent' | 'perm' | 'attach' | 'think';
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
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
    const order: Array<'always' | 'project' | 'never'> = ['always', 'project', 'never'];
    const cur = settings.toolApprovalMode || 'always';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await useAppStore.getState().updateSettings({ toolApprovalMode: next });
  };

  const permLabel = settings.toolApprovalMode === 'never' ? 'No approval'
    : settings.toolApprovalMode === 'project' ? 'Ask once/session'
    : 'Always ask';

  return (
    <div ref={toolbarRef} className="flex items-center justify-between gap-1 px-2 py-1.5 border-t border-border">
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
            title="Tool approval"
            className={`p-1.5 rounded transition ${settings.toolApprovalMode === 'never' ? 'text-warn bg-warn/10' : 'text-fg-muted hover:text-fg hover:bg-bg-elev'}`}
          >
            <ShieldIcon />
          </button>
          {permMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 menu-panel overflow-hidden min-w-52 z-50">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Tool approval</div>
              {(['always', 'project', 'never'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={async () => { await useAppStore.getState().updateSettings({ toolApprovalMode: mode }); closeAll(); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-bg-input ${settings.toolApprovalMode === mode ? 'text-accent' : 'text-fg'}`}
                >
                  <span>{mode === 'always' ? 'Always ask' : mode === 'project' ? 'Ask once per session' : 'Never ask (trust all)'}</span>
                  {settings.toolApprovalMode === mode && <CheckMark />}
                </button>
              ))}
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
      <div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu('agent')}
            title="Agent"
            className="px-2 py-1 rounded text-[11px] hover:bg-bg-elev text-fg-muted hover:text-fg flex items-center gap-1"
          >
            <AgentIcon />
            <span className="capitalize">{agent}</span>
            <ChevronIcon />
          </button>
          {agentMenuOpen && (
            <div className="absolute bottom-full right-0 mb-1 menu-panel overflow-hidden min-w-40 z-50">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Agent</div>
              {['default', 'explore', 'review'].map((a) => (
                <button
                  key={a}
                  onClick={() => { setAgent(a); closeAll(); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-bg-input ${agent === a ? 'text-accent' : 'text-fg'}`}
                >
                  <span className="capitalize">{a}</span>
                  {agent === a && <CheckMark />}
                </button>
              ))}
              <div className="px-3 py-2 text-[10px] text-fg-subtle border-t border-border/50">More agents coming soon</div>
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
                            onClick={(e) => { e.stopPropagation(); selectedProviderId && toggleFavourite(selectedProviderId, m.id); }}
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
            onClick={() => toggleMenu('think')}
            title={`Thinking effort: ${reasoning}`}
            className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 transition ${
              reasoning === 'off' ? 'text-fg-muted hover:text-fg hover:bg-bg-elev'
              : reasoning === 'low' ? 'text-success bg-success/10 hover:bg-success/20'
              : reasoning === 'medium' ? 'text-accent bg-accent/10 hover:bg-accent/20'
              : 'text-warn bg-warn/10 hover:bg-warn/20'
            }`}
          >
            <BrainIcon />
            <span className="capitalize">{reasoning === 'off' ? 'Think' : reasoning}</span>
            <ChevronIcon />
          </button>
          {thinkMenuOpen && (
            <div className="absolute bottom-full right-0 mb-1 menu-panel overflow-hidden min-w-44 z-50">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-border/50">Thinking effort</div>
              {([
                { id: 'off', label: 'Off', desc: 'Respond directly' },
                { id: 'low', label: 'Low', desc: 'Brief reasoning' },
                { id: 'medium', label: 'Medium', desc: 'Balanced' },
                { id: 'high', label: 'High', desc: 'Deep reasoning' }
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
function SendIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  );
}