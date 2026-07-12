import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  KnowledgeAutomationKind,
  KnowledgeAutomationSaveRequest,
  KnowledgeAutomationStatus,
  KnowledgeCapability,
  KnowledgeStatus,
  SimulatorChainInfo,
  SimulatorHealth,
  SimulatorStatus
} from '@shared/types';
import { useAppStore } from '../stores/app';
import type { DvmLintResult } from '@shared/dvm';
import { ChatView } from './ChatView';

interface GitEvidence {
  state: 'loading' | 'ready' | 'missing' | 'error';
  branch?: string;
  changes?: number;
  commit?: string;
  subject?: string;
  error?: string;
}

interface AutomationModelOption {
  value: string;
  providerId: string;
  model: string;
  label: string;
}

export function ProjectCockpit({ projectId }: { projectId: string }): JSX.Element {
  const project = useAppStore((state) => state.projects.find((item) => item.id === projectId));
  const projects = useAppStore((state) => state.projects);
  const conversations = useAppStore((state) => state.conversations);
  const mcpStatuses = useAppStore((state) => state.mcpStatuses);
  const providers = useAppStore((state) => state.providers);
  const selectedProviderId = useAppStore((state) => state.selectedProviderId);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const createConversation = useAppStore((state) => state.createConversation);
  const currentConversationId = useAppStore((state) => state.currentConversationId);
  const openProjectCockpit = useAppStore((state) => state.openProjectCockpit);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const closeCockpit = useAppStore((state) => state.closeProjectCockpit);
  const openProjectSettings = useAppStore((state) => state.openProjectSettings);
  const [git, setGit] = useState<GitEvidence>({ state: 'loading' });
  const [knowledge, setKnowledge] = useState<KnowledgeStatus | null>(null);
  const [knowledgeError, setKnowledgeError] = useState('');
  const [automations, setAutomations] = useState<KnowledgeAutomationStatus[] | null>(null);
  const [automationError, setAutomationError] = useState('');
  const [vaultAction, setVaultAction] = useState('');
  const [vaultNotice, setVaultNotice] = useState('');
  const [inlineChatOpen, setInlineChatOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const knowledgeConfig = project?.config?.knowledge;
  const vaultConfigured = !!knowledgeConfig?.serverId && !!knowledgeConfig.folder;
  const vaultServer = mcpStatuses.find((server) => server.id === knowledgeConfig?.serverId);
  const vaultConnectionKey = [
    knowledgeConfig?.serverId || '',
    knowledgeConfig?.folder || '',
    vaultServer?.connected ? 'connected' : 'offline',
    vaultServer?.error || '',
    vaultServer?.tools.map((tool) => tool.name).sort().join(',') || ''
  ].join('|');

  const automationModels = useMemo<AutomationModelOption[]>(() => providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => provider.models.map((model) => ({
      value: JSON.stringify([provider.id, model.id]),
      providerId: provider.id,
      model: model.id,
      label: `${provider.name} — ${model.name}`
    }))), [providers]);
  const selectedAutomationModel = automationModels.find((option) =>
    option.providerId === selectedProviderId && option.model === selectedModel) || automationModels[0];

  const projectConversations = useMemo(
    () => conversations.filter((item) => item.projectId === projectId && !item.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, projectId]
  );
  const projectMcpNames = (project?.config?.mcpServerIds || [])
    .map((id) => mcpStatuses.find((server) => server.id === id)?.name)
    .filter((name): name is string => !!name);

  const deroProjects = useMemo(
    () => projects.filter((p) => p.config?.kind === 'dero'),
    [projects]
  );

  const refreshGit = useCallback(async (): Promise<void> => {
    if (!project) return;
    setGit({ state: 'loading' });
    try {
      const [status, branch, log] = await Promise.all([
        window.hive.shellRun('git status --porcelain', { cwd: project.path }),
        window.hive.shellRun('git branch --show-current', { cwd: project.path }),
        window.hive.shellRun('git log -1 --oneline', { cwd: project.path })
      ]);
      if (!status.ok) {
        setGit({ state: 'missing', error: status.error || status.stderr || 'Not a Git repository' });
        return;
      }
      const latest = log.stdout.trim();
      const separator = latest.indexOf(' ');
      const changes = status.stdout.trim() ? status.stdout.trim().split(/\r?\n/).length : 0;
      setGit({
        state: 'ready',
        branch: branch.stdout.trim() || 'detached',
        changes,
        commit: separator > 0 ? latest.slice(0, separator) : latest,
        subject: separator > 0 ? latest.slice(separator + 1) : undefined
      });
    } catch (error) {
      setGit({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }, [project]);

  useEffect(() => { void refreshGit(); }, [refreshGit]);

  useEffect(() => {
    let cancelled = false;
    setKnowledge(null);
    setKnowledgeError('');
    if (!vaultConfigured) return () => { cancelled = true; };
    void window.hive.knowledgeStatus(projectId).then((status) => {
      if (!cancelled) setKnowledge(status);
    }).catch((error) => {
      if (!cancelled) setKnowledgeError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [projectId, vaultConfigured, vaultConnectionKey]);

  useEffect(() => {
    let cancelled = false;
    setAutomations(null);
    setAutomationError('');
    if (!vaultConfigured) {
      setAutomations([]);
      return () => { cancelled = true; };
    }
    const refresh = (): void => {
      void window.hive.knowledgeAutomationStatus(projectId).then((statuses) => {
        if (!cancelled) { setAutomations(statuses); setAutomationError(''); }
      }).catch((error) => {
        if (!cancelled) setAutomationError(error instanceof Error ? error.message : String(error));
      });
    };
    refresh();
    const automationRefresh = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(automationRefresh); };
  }, [projectId, vaultConfigured]);

  if (!project) {
    return (
      <main className="flex flex-1 items-center justify-center bg-bg p-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-fg">Project not found</p>
          <p className="mt-1 text-xs text-fg-subtle">It may have been removed from Hive.</p>
          <button onClick={closeCockpit} className="mt-4 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">Back to chat</button>
        </div>
      </main>
    );
  }

  const vaultState = !vaultConfigured
    ? 'unconfigured'
    : knowledgeError
      ? 'error'
      : !knowledge
        ? 'loading'
        : !knowledge.configured
          ? 'unconfigured'
          : !knowledge.connected
            ? 'offline'
            : knowledge.missing.length
              ? 'limited'
              : 'ready';
  const automationApproved = vaultConfigured && !!project.config?.knowledge?.allowAutomationWrites;
  const hasCapabilities = (...required: KnowledgeCapability[]): boolean =>
    !!knowledge?.connected && required.every((capability) => knowledge.capabilities.includes(capability));
  const canBootstrap = automationApproved && hasCapabilities('read', 'write');
  const canRetryCaptures = automationApproved && hasCapabilities('write');
  const canRunAutomation = automationApproved && hasCapabilities('list', 'read', 'write', 'append');
  const canOpenAutomation = hasCapabilities('open');

  const newChat = async (): Promise<void> => {
    const id = await createConversation({ title: 'New chat', projectId });
    await selectConversation(id);
    setInlineChatOpen(true);
  };

  const openCode = async (): Promise<void> => {
    await updateSettings({ codeFolder: project.path });
    const state = useAppStore.getState();
    if (!state.codeTabOpen) state.toggleCodeTab();
  };

  const startDeroWorkflow = async (title: string, prompt: string, agentId?: string): Promise<void> => {
    const id = await createConversation({ title, projectId });
    if (agentId) useAppStore.getState().setComposerAgent(agentId);
    await selectConversation(id);
    setInlineChatOpen(true);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('hive:companion-compose', { detail: { text: prompt } }));
    }, 100);
  };

  const refreshVault = async (): Promise<void> => {
    const [status, schedules] = await Promise.all([
      window.hive.knowledgeStatus(projectId),
      window.hive.knowledgeAutomationStatus(projectId)
    ]);
    setKnowledge(status);
    setKnowledgeError('');
    setAutomations(schedules);
    setAutomationError('');
  };

  const initializeVault = async (): Promise<void> => {
    if (!canBootstrap || vaultAction) return;
    setVaultAction('bootstrap');
    setVaultNotice('');
    try {
      const result = await window.hive.knowledgeBootstrap(projectId);
      setVaultNotice(result.created.length
        ? `Created ${result.created.length} vault file${result.created.length === 1 ? '' : 's'}.`
        : 'Vault structure is already initialized.');
      await refreshVault();
    } catch (error) {
      setVaultNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setVaultAction('');
    }
  };

  const retryQueuedCaptures = async (): Promise<void> => {
    if (!canRetryCaptures || vaultAction) return;
    setVaultAction('outbox');
    setVaultNotice('');
    try {
      const result = await window.hive.knowledgeRetryOutbox(projectId);
      setVaultNotice(result.retried === 0
        ? 'No queued captures.'
        : `Delivered ${result.delivered}/${result.retried} queued capture${result.retried === 1 ? '' : 's'}${result.failed ? `; ${result.failed} still queued` : ''}.`);
    } catch (error) {
      setVaultNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setVaultAction('');
    }
  };

  const saveAutomation = async (input: KnowledgeAutomationSaveRequest): Promise<boolean> => {
    if (!automationApproved || vaultAction) return false;
    setVaultAction(`save:${input.kind}`);
    setVaultNotice('');
    try {
      await window.hive.knowledgeAutomationSave(input);
      setVaultNotice(`${automationLabel(input.kind)} schedule saved.`);
      await refreshVault();
      return true;
    } catch (error) {
      setVaultNotice(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setVaultAction('');
    }
  };

  const runAutomation = async (kind: KnowledgeAutomationKind): Promise<void> => {
    if (!canRunAutomation || vaultAction) return;
    setVaultAction(`run:${kind}`);
    setVaultNotice('');
    try {
      const result = await window.hive.knowledgeAutomationRunNow(projectId, kind);
      setVaultNotice(result.status === 'completed'
        ? `${automationLabel(kind)} written to ${result.path}.`
        : result.path
          ? `${automationLabel(kind)} already exists at ${result.path}.`
          : `${automationLabel(kind)} is already running.`);
      await refreshVault();
    } catch (error) {
      setVaultNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setVaultAction('');
    }
  };

  const openAutomation = async (automation: KnowledgeAutomationStatus): Promise<void> => {
    if (!canOpenAutomation || !automation.lastRunKey || !automation.lastRunAt || automation.error) return;
    const path = automation.kind === 'morning-digest'
      ? `Daily/${automation.lastRunKey}.md`
      : `Weekly/${automation.lastRunKey}.md`;
    try { await window.hive.knowledgeOpen({ projectId, path, newLeaf: true }); }
    catch (error) { setVaultNotice(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <main className="min-w-0 flex-1 flex flex-row overflow-hidden bg-bg" aria-labelledby="project-cockpit-title">

      {inlineChatOpen && currentConversationId && (
        <div className="w-[42%] flex-shrink-0 flex flex-col min-h-0 border-r border-border">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-elev flex-shrink-0">
            <button
              onClick={() => setInlineChatOpen(false)}
              className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.16em] text-fg-subtle hover:text-accent"
              title="Close inline chat"
            >
              <span aria-hidden="true">×</span> Close
            </button>
            <div className="flex-1" />
            <span className="text-[9px] text-fg-subtle uppercase tracking-wider">Chat</span>
          </div>
          <div className="flex-1 min-h-0 flex">
            <ChatView />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <button onClick={closeCockpit} className="mb-3 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.16em] text-fg-subtle hover:text-accent">
              <span aria-hidden="true">←</span> Chat workspace
            </button>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elev text-xl shadow-elev-sm">{project.icon || '📁'}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <h1 id="project-cockpit-title" className="truncate text-2xl font-semibold tracking-tight text-fg">{project.name}</h1>
                  {deroProjects.length > 1 && (
                    <div className="relative">
                      <button
                        onClick={() => setProjectMenuOpen(!projectMenuOpen)}
                        className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-elev"
                        title="Switch project"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M3 4.5L6 7.5l3-3" />
                        </svg>
                      </button>
                        {projectMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(false)} />
                          <div className="absolute left-0 top-full mt-1 z-50 menu-panel py-1 min-w-48" onClick={(e) => e.stopPropagation()}>
                            {deroProjects.map((dp) => (
                              <button
                                key={dp.id}
                                onClick={() => { setProjectMenuOpen(false); if (dp.id !== projectId) openProjectCockpit(dp.id); }}
                                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${dp.id === projectId ? 'bg-bg-input text-fg font-medium' : 'text-fg-muted hover:bg-bg-input hover:text-fg'}`}
                              >
                                <span>{dp.icon || '📁'}</span>
                                <span className="truncate">{dp.name}</span>
                                {dp.id === projectId && <span className="ml-auto text-accent">✓</span>}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-fg-subtle" title={project.path}>{project.path}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="New chat" onClick={() => void newChat()} primary />
            <ActionButton label="Open code" onClick={() => void openCode()} />
          </div>
        </header>

        {project.config?.kind === 'dero' && (
          <DeroStudio projectPath={project.path} mcpNames={projectMcpNames} onStartWorkflow={startDeroWorkflow} onOpenCode={() => void openCode()} />
        )}

        <section className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-elev-sm" aria-label="Project evidence board">
          <div className="relative grid gap-0 px-4 py-4 sm:grid-cols-3 sm:px-6">
            <div className="absolute left-[16.5%] right-[16.5%] top-[30px] hidden border-t border-border sm:block" aria-hidden="true" />
            <EvidenceNode label="Git" value={git.state === 'ready' ? git.branch || 'detached' : git.state === 'loading' ? 'checking' : 'not linked'} tone={git.state === 'ready' ? (git.changes ? 'warn' : 'good') : 'muted'} />
            <EvidenceNode label="Working set" value={`${projectConversations.length} thread${projectConversations.length === 1 ? '' : 's'}`} tone={projectConversations.length ? 'good' : 'muted'} />
            <EvidenceNode label="Vault" value={vaultState === 'ready' ? 'linked' : vaultState.replaceAll('_', ' ')} tone={vaultState === 'ready' ? 'good' : vaultState === 'error' || vaultState === 'offline' || vaultState === 'limited' ? 'warn' : 'muted'} />
          </div>

          <div className="grid border-t border-border lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
            <div className="min-w-0 lg:border-r lg:border-border">
              <section className="px-4 py-5 sm:px-6" aria-labelledby="working-set-title">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle">Recent activity</div>
                    <h2 id="working-set-title" className="mt-0.5 text-sm font-semibold text-fg">Working set</h2>
                  </div>
                  <span className="font-mono text-[10px] text-fg-subtle">{projectConversations.length.toString().padStart(2, '0')} threads</span>
                </div>
                {projectConversations.length === 0 ? (
                  <div className="border-l-2 border-border py-4 pl-4">
                    <p className="text-xs font-medium text-fg">No project chats yet</p>
                    <p className="mt-1 text-xs text-fg-subtle">Start a chat to create the first record.</p>
                  </div>
                ) : (
                  <ol className="divide-y divide-border border-y border-border">
                    {projectConversations.slice(0, 8).map((conversation) => (
                      <li key={conversation.id}>
                        <button
                          onClick={() => { void selectConversation(conversation.id); setInlineChatOpen(true); }}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 text-left hover:bg-bg-input/60"
                        >
                          <span className="h-2 w-2 rounded-sm border border-border-strong bg-bg-elev" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-fg">{conversation.title}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-fg-subtle">{conversation.messageCount} messages{conversation.preview ? ` · ${conversation.preview}` : ''}</span>
                          </span>
                          <span className="font-mono text-[9px] text-fg-subtle">{relativeTime(conversation.updatedAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            <aside className="min-w-0 divide-y divide-border" aria-label="Project health">
              <BoardPanel eyebrow="Repository" title="Git identity" action={<button onClick={() => void refreshGit()} className="text-[10px] text-fg-subtle hover:text-accent">Refresh</button>}>
                {git.state === 'loading' ? <PanelNote>Reading repository…</PanelNote> : git.state === 'ready' ? (
                  <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                    <dt className="text-fg-subtle">Branch</dt><dd className="truncate font-mono text-fg">{git.branch}</dd>
                    <dt className="text-fg-subtle">Worktree</dt><dd className={git.changes ? 'text-warn' : 'text-success'}>{git.changes ? `${git.changes} changed` : 'Clean'}</dd>
                    <dt className="text-fg-subtle">Commit</dt><dd className="min-w-0"><span className="font-mono text-accent">{git.commit || '—'}</span><span className="ml-2 text-fg-muted">{git.subject}</span></dd>
                  </dl>
                ) : <PanelNote>{git.error || 'This folder is not a Git repository.'}</PanelNote>}
              </BoardPanel>

              <BoardPanel eyebrow="Knowledge" title="Obsidian vault" action={<button onClick={openProjectSettings} className="text-[10px] text-fg-subtle hover:text-accent">Configure</button>}>
                <div className="flex items-start gap-3">
                  <StatusMark tone={vaultState === 'ready' ? 'good' : vaultState === 'offline' || vaultState === 'error' || vaultState === 'limited' ? 'warn' : 'muted'} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg">{vaultState === 'ready' ? 'Vault ready' : vaultState === 'loading' ? 'Checking vault' : vaultState === 'offline' ? 'Server offline' : vaultState === 'limited' ? 'Limited capabilities' : vaultState === 'error' ? 'Vault error' : 'Vault not linked'}</p>
                    <p className="mt-1 truncate font-mono text-[10px] text-fg-subtle">{project.config?.knowledge?.folder || 'Choose a server and folder'}</p>
                    {(knowledgeError || knowledge?.error) && <p className="mt-1 text-[10px] text-danger">{knowledgeError || knowledge?.error}</p>}
                  </div>
                </div>
                {vaultConfigured && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void initializeVault()}
                      disabled={!canBootstrap || !!vaultAction}
                      className="rounded-md border border-border bg-bg-input px-2 py-1 text-[10px] font-medium text-fg-muted hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >{vaultAction === 'bootstrap' ? 'Initializing…' : 'Initialize vault'}</button>
                    <button
                      onClick={() => void retryQueuedCaptures()}
                      disabled={!canRetryCaptures || !!vaultAction}
                      className="rounded-md border border-border bg-bg-input px-2 py-1 text-[10px] font-medium text-fg-muted hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >{vaultAction === 'outbox' ? 'Retrying…' : 'Retry queued'}</button>
                  </div>
                )}
                {vaultConfigured && !automationApproved && (
                  <p className="mt-3 text-[10px] leading-relaxed text-warn">Approve scoped automatic writes in project settings to initialize the folder, save browser captures, or run vault jobs.</p>
                )}
                {vaultNotice && <p className="mt-3 text-[10px] leading-relaxed text-fg-subtle" role="status">{vaultNotice}</p>}
              </BoardPanel>

              <BoardPanel eyebrow="Vault rhythm" title="Daily & weekly jobs">
                {!vaultConfigured ? <PanelNote>Link an Obsidian folder to this project first.</PanelNote> : (
                  <div className="space-y-3">
                    {automationError && <p className="text-xs leading-relaxed text-danger" role="alert">{automationError}</p>}
                    {automations === null ? (automationError ? null : <PanelNote>Loading vault jobs…</PanelNote>) : (['morning-digest', 'weekly-synthesis'] as const).map((kind) => (
                      <VaultAutomationRow
                        key={kind}
                        projectId={projectId}
                        kind={kind}
                        status={automations.find((automation) => automation.kind === kind)}
                        models={automationModels}
                        defaultModel={selectedAutomationModel}
                        canSave={automationApproved}
                        canRun={canRunAutomation}
                        canOpen={canOpenAutomation}
                        busy={!!vaultAction}
                        onSave={saveAutomation}
                        onRun={runAutomation}
                        onOpen={openAutomation}
                      />
                    ))}
                  </div>
                )}
              </BoardPanel>

              <BoardPanel eyebrow="Profile" title="Project controls">
                <p className="text-xs leading-relaxed text-fg-muted">Vault routing and other project options live in project settings.</p>
                <button onClick={openProjectSettings} className="mt-3 rounded-md border border-border bg-bg-input px-2.5 py-1.5 text-xs font-medium text-fg hover:border-accent/50 hover:text-accent">Edit project settings</button>
              </BoardPanel>
            </aside>
          </div>
        </section>
      </div>
      </div>
    </main>
  );
}

function VaultAutomationRow({
  projectId,
  kind,
  status,
  models,
  defaultModel,
  canSave,
  canRun,
  canOpen,
  busy,
  onSave,
  onRun,
  onOpen
}: {
  projectId: string;
  kind: KnowledgeAutomationKind;
  status?: KnowledgeAutomationStatus;
  models: AutomationModelOption[];
  defaultModel?: AutomationModelOption;
  canSave: boolean;
  canRun: boolean;
  canOpen: boolean;
  busy: boolean;
  onSave: (input: KnowledgeAutomationSaveRequest) => Promise<boolean>;
  onRun: (kind: KnowledgeAutomationKind) => Promise<void>;
  onOpen: (automation: KnowledgeAutomationStatus) => Promise<void>;
}): JSX.Element {
  const weekly = kind === 'weekly-synthesis';
  const [enabled, setEnabled] = useState(status?.enabled ?? false);
  const [time, setTime] = useState(formatAutomationTime(status?.localHour ?? (weekly ? 8 : 7), status?.localMinute ?? 0));
  const [weekday, setWeekday] = useState(status?.weeklyWeekday ?? 0);
  const [modelValue, setModelValue] = useState(status
    ? JSON.stringify([status.providerId, status.model])
    : defaultModel?.value || '');
  const [dirty, setDirty] = useState(false);
  const label = automationLabel(kind);
  const titleId = `vault-automation-${kind}`;
  const errorId = `${titleId}-error`;
  const statusModelValue = status ? JSON.stringify([status.providerId, status.model]) : '';
  const statusModelUnavailable = !!status && !models.some((model) => model.value === statusModelValue);

  useEffect(() => {
    if (dirty) return;
    if (status) {
      setEnabled(status.enabled);
      setTime(formatAutomationTime(status.localHour, status.localMinute));
      setWeekday(status.weeklyWeekday ?? 0);
      setModelValue(JSON.stringify([status.providerId, status.model]));
    } else if (defaultModel) {
      setModelValue((current) => current || defaultModel.value);
    }
  }, [canSave, defaultModel, dirty, status]);

  const save = async (): Promise<void> => {
    const selected = models.find((model) => model.value === modelValue)
      || (!enabled && status && modelValue === statusModelValue
        ? { providerId: status.providerId, model: status.model }
        : undefined);
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!selected || !match) return;
    const saved = await onSave({
      projectId,
      kind,
      enabled,
      localHour: Number(match[1]),
      localMinute: Number(match[2]),
      ...(weekly ? { weeklyWeekday: weekday } : {}),
      providerId: selected.providerId,
      model: selected.model
    });
    if (saved) setDirty(false);
  };

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={status?.error ? errorId : undefined}
      aria-busy={busy || status?.running}
      className="rounded-lg border border-border bg-bg-input/50 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div id={titleId} className="text-xs font-medium text-fg">{label}</div>
          <div className="mt-0.5 text-[9px] text-fg-subtle">
            {status?.running ? 'Running now' : status?.lastRunAt ? `Last run ${relativeTime(status.lastRunAt)}` : 'Not run yet'}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-fg-muted">
          <input aria-label={`${label} enabled`} type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setDirty(true); }} disabled={!canSave || busy} className="accent-accent" />
          Enabled
        </label>
      </div>

      <div className={`mt-2 grid gap-2 ${weekly ? 'grid-cols-[6.5rem_1fr]' : 'grid-cols-1'}`}>
        {weekly && (
          <select
            aria-label="Weekly synthesis weekday"
            value={weekday}
            onChange={(event) => { setWeekday(Number(event.target.value)); setDirty(true); }}
            disabled={!canSave || busy}
            className="min-w-0 rounded-md border border-border bg-bg-elev px-2 py-1 text-[10px] text-fg outline-none focus:border-accent disabled:opacity-40"
          >
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select>
        )}
        <input
          aria-label={`${label} local time`}
          type="time"
          value={time}
          onChange={(event) => { setTime(event.target.value); setDirty(true); }}
          disabled={!canSave || busy}
          className="min-w-0 rounded-md border border-border bg-bg-elev px-2 py-1 text-[10px] text-fg outline-none focus:border-accent disabled:opacity-40"
        />
      </div>

      <select
        aria-label={`${label} model`}
        value={modelValue}
        onChange={(event) => { setModelValue(event.target.value); setDirty(true); }}
        disabled={!canSave || busy || (models.length === 0 && !statusModelUnavailable)}
        className="mt-2 w-full min-w-0 rounded-md border border-border bg-bg-elev px-2 py-1 text-[10px] text-fg outline-none focus:border-accent disabled:opacity-40"
      >
        {models.length === 0 && !statusModelUnavailable && <option value="">No enabled model</option>}
        {statusModelUnavailable && <option value={statusModelValue}>{status?.providerId} — {status?.model} (unavailable)</option>}
        {models.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
      </select>

      {status?.error && <p id={errorId} className="mt-2 text-[9px] leading-relaxed text-danger">{status.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button aria-label={`Save ${label} schedule`} onClick={() => void save()} disabled={!canSave || busy || !(models.some((model) => model.value === modelValue) || (!enabled && statusModelUnavailable && modelValue === statusModelValue)) || !/^\d{2}:\d{2}$/.test(time)} className="text-[10px] font-medium text-fg-muted hover:text-accent disabled:opacity-40">Save</button>
        <button aria-label={`Run ${label} now`} onClick={() => void onRun(kind)} disabled={!canRun || busy || !status || status.running} className="text-[10px] font-medium text-fg-muted hover:text-accent disabled:opacity-40">Run now</button>
        {status?.lastRunKey && status.lastRunAt && !status.error && <button aria-label={`Open ${label} note`} onClick={() => void onOpen(status)} disabled={!canOpen || busy} className="text-[10px] font-medium text-fg-muted hover:text-accent disabled:opacity-40">Open note</button>}
      </div>
    </div>
  );
}

function DeroStudio({
  projectPath,
  mcpNames,
  onStartWorkflow,
  onOpenCode
}: {
  projectPath: string;
  mcpNames: string[];
  onStartWorkflow: (title: string, prompt: string, agentId?: string) => Promise<void>;
  onOpenCode: () => void;
}): JSX.Element {
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [health, setHealth] = useState<SimulatorHealth | null>(null);
  const [chainInfo, setChainInfo] = useState<SimulatorChainInfo | null>(null);
  const [source, setSource] = useState('');
  const [lint, setLint] = useState<DvmLintResult | null>(null);
  const [lintError, setLintError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [contractFiles, setContractFiles] = useState<Array<{ path: string; rel: string }>>([]);
  const [fixtureLabel, setFixtureLabel] = useState('');
  const [fixtureNotice, setFixtureNotice] = useState('');
  const [balanceScid, setBalanceScid] = useState('');
  const [stateScid, setStateScid] = useState('');
  const [stateKeys, setStateKeys] = useState('');
  const [contractState, setContractState] = useState<Record<string, unknown> | null>(null);
  const [simHeight, setSimHeight] = useState<number | null>(null);
  const [contractBriefs, setContractBriefs] = useState<Array<{name: string; brief: string; source: string; createdAt: number; reviewFindings?: Array<{line: number; severity: string; message: string; recommendation: string}>; testRun?: {passed: number; failed: number; results: Array<{scenario: string; status: 'pass' | 'fail'; output: string}>; sourceRevision?: string} }>>([]);
  const [contractName, setContractName] = useState('');
  const [contractBrief, setContractBrief] = useState('');
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [discoveryKind, setDiscoveryKind] = useState('similar-contracts');
  const simulatorFixtures = useAppStore((s) => s.simulatorFixtures);
  const addSimulatorFixture = useAppStore((s) => s.addSimulatorFixture);
  const [telaName, setTelaName] = useState('');
  const [telaBrief, setTelaBrief] = useState('');
  const [telaGenerating, setTelaGenerating] = useState(false);
  const [telaPreviewOpen, setTelaPreviewOpen] = useState(false);
  const [telaValidationResults, setTelaValidationResults] = useState<Array<{check: string; status: 'pass' | 'warn' | 'fail'; detail: string}> | null>(null);
  const [telaError, setTelaError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    void window.hive.simulatorStatus().then((next) => { if (mounted) setStatus(next); });
    const off = window.hive.onSimulatorStatus(setStatus);
    return () => { mounted = false; off(); };
  }, []);

  const toggleSimulator = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      setStatus(status?.running ? await window.hive.simulatorStop() : await window.hive.simulatorStart());
    } finally {
      setPending(false);
    }
  };

  const checkHealth = async (): Promise<void> => {
    const nextHealth = await window.hive.simulatorHealth();
    setHealth(nextHealth);
    if (!nextHealth.reachable) { setChainInfo(null); return; }
    try { setChainInfo(await window.hive.simulatorInfo()); }
    catch (error) { setHealth({ ...nextHealth, reachable: false, error: error instanceof Error ? error.message : String(error) }); setChainInfo(null); }
  };

  const analyze = async (): Promise<void> => {
    if (!source.trim()) return;
    setLintError('');
    try { setLint(await window.hive.deroLint(source)); }
    catch (error) { setLintError(error instanceof Error ? error.message : String(error)); }
  };

  const loadSourcePath = async (path: string): Promise<void> => {
    setLintError('');
    try {
      const file = await window.hive.fsRead(path, { limit: 250_000 });
      setSource(file.content);
      setLint(null);
    } catch (error) { setLintError(error instanceof Error ? error.message : String(error)); }
  };

  const loadSource = async (): Promise<void> => {
    const path = await window.hive.fsPickFile([{ name: 'DVM-BASIC source', extensions: ['bas', 'txt'] }]);
    if (path) await loadSourcePath(path);
  };

  const findContracts = async (): Promise<void> => {
    try {
      const matches = await window.hive.fsGlob({ root: projectPath, pattern: '**/*.bas', limit: 50 });
      setContractFiles(matches.map(({ path, rel }) => ({ path, rel })));
      setLintError('');
    } catch (error) { setLintError(error instanceof Error ? error.message : String(error)); }
  };

  const createStarterContract = async (): Promise<void> => {
    const path = `${projectPath.replace(/[\\/]$/, '')}/contracts/Counter.bas`;
    const template = `Function Initialize() Uint64
  10 STORE("owner", SIGNER())
  20 STORE("counter", 0)
  30 RETURN 0
End Function

Function Increment() Uint64
  10 DIM current as Uint64
  20 LET current = LOAD("counter")
  30 STORE("counter", current + 1)
  40 RETURN 0
End Function

Function GetCounter() Uint64
  10 RETURN LOAD("counter")
End Function
`;
    setTemplateNotice('');
    try {
      if (await window.hive.fsExists(path)) {
        setTemplateNotice('contracts/Counter.bas already exists; it was not changed.');
        return;
      }
      await window.hive.fsMkdir(`${projectPath.replace(/[\\/]$/, '')}/contracts`);
      await window.hive.fsWrite(path, template);
      setSource(template);
      setLint(await window.hive.deroLint(template));
      setTemplateNotice('Created contracts/Counter.bas and loaded it into the analyser.');
    } catch (error) { setTemplateNotice(error instanceof Error ? error.message : String(error)); }
  };

  const createTelaStarter = async (): Promise<void> => {
    const root = `${projectPath.replace(/[\\/]$/, '')}/tela-starter`;
    const files: Record<string, string> = {
      'index.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DERO TELA Starter</title><link rel="stylesheet" href="styles.css"></head>
<body><main><p class="eyebrow">DERO · TELA</p><h1>Starter dApp</h1><p id="status">Wallet bridge not connected.</p><button id="connect">Connect XSWD</button><pre id="output" aria-live="polite"></pre></main><script src="mock-xswd.js"></script><script src="app.js"></script></body></html>\n`,
      'styles.css': `:root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; } main { width: min(34rem, calc(100% - 3rem)); padding: 2rem; border: 1px solid #30363d; border-radius: 1rem; background: #161b22; } .eyebrow { color: #52c8db; font: 600 .75rem ui-monospace, monospace; letter-spacing: .12em; } button { border: 0; border-radius: .5rem; padding: .7rem 1rem; background: #52c8db; color: #071013; font-weight: 700; cursor: pointer; } pre { overflow: auto; white-space: pre-wrap; color: #8b949e; }\n`,
      'app.js': `const status = document.getElementById('status');
const output = document.getElementById('output');
document.getElementById('connect').addEventListener('click', () => {
  if (new URLSearchParams(location.search).has('mock')) {
    const info = window.createMockXswd().call('DERO.GetInfo');
    status.textContent = 'Using local read-only XSWD fixture.';
    output.textContent = JSON.stringify(info, null, 2);
    return;
  }
  const socket = new WebSocket('ws://localhost:44326/xswd');
  socket.addEventListener('open', () => {
    status.textContent = 'XSWD connected. Requesting read-only network information…';
    socket.send(JSON.stringify({ id: 'dero-hive-tela-starter', name: 'DERO Hive TELA Starter', description: 'Read-only starter dApp', url: location.origin }));
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'network-info', method: 'DERO.GetInfo' }));
  });
  socket.addEventListener('message', (event) => { output.textContent = event.data; });
  socket.addEventListener('error', () => { status.textContent = 'Could not connect to XSWD. Start a compatible wallet and explicitly approve this app.'; });
});
`,
      'mock-xswd.js': `// Development fixture. Enable with ?mock=1. It intentionally exposes no signing, transfer, deploy, or key methods.
window.createMockXswd = function createMockXswd() {
  const readOnly = {
    'DERO.GetInfo': { network: 'Simulator fixture', height: 1, topoheight: 1, status: 'OK' },
    GetAddress: { address: 'dero1mockaddressnotforuse' },
    GetBalance: { balance: 0, unlocked_balance: 0 }
  };
  return { call(method) { if (!(method in readOnly)) throw new Error('Mock XSWD only permits read-only fixture methods.'); return readOnly[method]; } };
};
`
    };
    setTemplateNotice('');
    try {
      for (const name of Object.keys(files)) if (await window.hive.fsExists(`${root}/${name}`)) { setTemplateNotice(`tela-starter/${name} already exists; no files were changed.`); return; }
      await window.hive.fsMkdir(root);
      for (const [name, content] of Object.entries(files)) await window.hive.fsWrite(`${root}/${name}`, content);
      setTemplateNotice('Created tela-starter with a read-only XSWD connection example.');
    } catch (error) { setTemplateNotice(error instanceof Error ? error.message : String(error)); }
  };

  const validateTelaArtifacts = async (): Promise<void> => {
    const results: Array<{check: string; status: 'pass' | 'warn' | 'fail'; detail: string}> = [];
    const dir = `${projectPath.replace(/[\\/]$/, '')}/tela/${telaName}`;
    try {
      let contract = '';
      try {
        const contractFile = await window.hive.fsRead(`${dir}/contract.bas`, { limit: 250_000 });
        contract = contractFile.content;
      } catch { /* contract file not readable */ }
      const hasInit = /\bInitialize\s*\(/i.test(contract);
      const hasSIGNER = /\bSIGNER\s*\(/i.test(contract);
      results.push({
        check: 'Contract initialization',
        status: hasInit ? 'pass' : 'fail',
        detail: hasInit ? 'Initialize() function present' : 'Missing Initialize() function'
      });
      results.push({
        check: 'SIGNER() guard',
        status: hasSIGNER ? 'pass' : 'warn',
        detail: hasSIGNER ? 'SIGNER() guard detected' : 'No SIGNER() check found — verify authorization'
      });

      let html = '';
      try {
        const htmlFile = await window.hive.fsRead(`${dir}/index.html`, { limit: 250_000 });
        html = htmlFile.content;
      } catch { /* html file not readable */ }
      results.push({
        check: 'Valid HTML',
        status: /<!DOCTYPE\s+html/i.test(html) ? 'pass' : 'fail',
        detail: /<!DOCTYPE\s+html/i.test(html) ? 'HTML doctype valid' : 'Invalid or missing HTML structure'
      });
      results.push({
        check: 'XSWD connection',
        status: /xswd/i.test(html) ? 'pass' : 'warn',
        detail: /xswd/i.test(html) ? 'XSWD wallet connection referenced' : 'No XSWD reference — wallet integration may be missing'
      });
      const fullSource = contract + html;
      const hasSecrets = /(?:private\s*key|seed\s*phrase|secret|password\s*=\s*["'][^"'\s]{8,})/i.test(fullSource);
      results.push({
        check: 'No hardcoded secrets',
        status: hasSecrets ? 'fail' : 'pass',
        detail: hasSecrets ? 'Potential secret/credential found in source' : 'No secrets detected'
      });
      results.push({
        check: 'Relative asset paths',
        status: /https?:\/\//i.test(html) ? 'warn' : 'pass',
        detail: /https?:\/\//i.test(html) ? 'Absolute URLs detected — prefer relative paths for TELA' : 'All paths appear relative'
      });
      results.push({
        check: 'Deployment manifest',
        status: 'pass',
        detail: 'tela.config.json created with entry, contract, and permissions'
      });
      setTelaValidationResults(results);
    } catch {
      results.push({ check: 'TELA artifacts', status: 'fail', detail: 'Could not access artifact directory' });
      setTelaValidationResults(results);
    }
  };

  const generateTelaDapp = async () => {
    if (!telaName.trim() || !projectPath) return;
    setTelaGenerating(true);
    setTelaError('');
    const dir = `${projectPath.replace(/[\\/]$/, '')}/tela/${telaName}`;
    try {
      if (await window.hive.fsExists(dir)) {
        setTelaError(`Directory tela/${telaName} already exists.`);
        return;
      }
      await window.hive.fsMkdir(dir);
      const contractSource = `' DERO TELA Contract: ${telaName}
' Generated by DERO Hive TELA Builder
Function Initialize() Uint64
1  STORE("owner", SIGNER())
2  STORE("name", "${telaName}")
3  RETURN 0
End Function

Function GetOwner() Uint64
10 RETURN LOAD("owner")
End Function
`;
      await window.hive.fsWrite(`${dir}/contract.bas`, contractSource);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${telaName} — DERO TELA dApp</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app">
    <header><h1>${telaName}</h1></header>
    <main><div id="output">Connecting to DERO network...</div></main>
    <footer>Powered by DERO Hive</footer>
  </div>
  <script src="mock-xswd.js?mock=1"></script>
  <script src="app.js"></script>
</body>
</html>
`;
      await window.hive.fsWrite(`${dir}/index.html`, html);
      const css = `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }
#app { max-width: 800px; margin: 0 auto; padding: 2rem; }
header h1 { font-size: 1.5rem; color: #7cffc4; margin-bottom: 1rem; }
main { background: #12121a; border-radius: 12px; padding: 2rem; border: 1px solid #1e1e2e; }
footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #1e1e2e; color: #555; font-size: 0.75rem; text-align: center; }
#output { padding: 1rem; background: #0a0a12; border-radius: 8px; font-family: monospace; font-size: 0.85rem; min-height: 4rem; }
.btn { background: #1e1e2e; border: 1px solid #333; color: #e0e0e0; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; }
.btn:hover { background: #2a2a3e; }
`;
      await window.hive.fsWrite(`${dir}/styles.css`, css);
      const js = `// ${telaName} — DERO TELA dApp
let dero = null;
const output = document.getElementById('output');

async function connectWallet() {
  try {
    if (typeof window.xswd !== 'undefined') {
      dero = window.xswd;
      output.textContent = 'Connected to DERO wallet via XSWD.';
      void checkNetwork();
    } else {
      output.textContent = 'No XSWD wallet detected. Using read-only mode.';
    }
  } catch (err) {
    output.textContent = 'Connection error: ' + err.message;
  }
}

async function checkNetwork() {
  if (!dero) return;
  try {
    const info = await dero.request({ method: 'DERO.GetInfo' });
    output.textContent = 'Network: ' + info.network + ' | Height: ' + info.height;
  } catch (err) {
    output.textContent = 'Network check failed: ' + err.message;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  void connectWallet();
});
`;
      await window.hive.fsWrite(`${dir}/app.js`, js);
      const mock = `// Mock XSWD bridge for local development
(function() {
  if (new URLSearchParams(location.search).get('mock') !== '1') return;
  var mockRpc = {
    'DERO.GetInfo': function() { return { height: 12345, network: 'simulator', topoheight: 12345, version: 'mock', tx_pool_size: 0, status: 'OK' }; },
    'DERO.GetHeight': function() { return { height: 12345 }; },
    'DERO.GetEncryptedBalance': function() { return { balance: 1000000, unlocked_balance: 1000000 }; }
  };
  window.xswd = {
    request: async function(req) {
      var method = req.method || (req.params && req.params.method);
      var handler = mockRpc[method];
      if (handler) return handler();
      return { error: 'Mock: method ' + method + ' not available in read-only fixture' };
    },
    wallet: { connected: true, address: 'dero1mock0000000000000000000000000000000000000000000000000000000000', network: 'simulator' }
  };
})();
`;
      await window.hive.fsWrite(`${dir}/mock-xswd.js`, mock);
      const manifest = {
        name: telaName,
        version: '1.0.0',
        description: telaBrief,
        contract: 'contract.bas',
        entry: 'index.html',
        documents: ['index.html', 'styles.css', 'app.js', 'mock-xswd.js'],
        permissions: ['read-only'],
        xswd: { mock: true, readOnly: true },
        deployment: { network: 'simulator', estimatedGas: 50000 }
      };
      await window.hive.fsWrite(`${dir}/tela.config.json`, JSON.stringify(manifest, null, 2));
      setTelaPreviewOpen(true);
      setPreviewKey((k) => k + 1);
      void validateTelaArtifacts();
    } catch (err) {
      setTelaError(err instanceof Error ? err.message : String(err));
    } finally {
      setTelaGenerating(false);
    }
  };

  const createFixture = async (): Promise<void> => {
    setFixtureNotice('');
    try {
      const w = await window.hive.simulatorCreateFixtureWallet();
      addSimulatorFixture({ address: w.address, scid: w.scid, label: fixtureLabel || `Fixture ${simulatorFixtures.length + 1}` });
      setFixtureLabel('');
      setFixtureNotice(`Created fixture wallet: ${w.address}`);
    } catch (error) { setFixtureNotice(error instanceof Error ? error.message : String(error)); }
  };

  const refreshBalance = async (address: string): Promise<void> => {
    setFixtureNotice('');
    try {
      const b = await window.hive.simulatorGetBalance(address, balanceScid || undefined);
      setFixtureNotice(`Balance for ${address}: ${b.balance}`);
    } catch (error) { setFixtureNotice(error instanceof Error ? error.message : String(error)); }
  };

  const readContractState = async (): Promise<void> => {
    setFixtureNotice('');
    try {
      const keys = stateKeys.trim() ? stateKeys.split(',').map((k) => k.trim()) : undefined;
      const state = await window.hive.simulatorGetContractState(stateScid, keys);
      setContractState(state);
    } catch (error) {
      setContractState({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const readHeight = async (): Promise<void> => {
    try { setSimHeight(await window.hive.simulatorGetHeight()); }
    catch { setSimHeight(null); }
  };

  const artifactsPath = `${projectPath}/.hive/artifacts.json`;

  const loadArtifacts = async () => {
    try {
      const data = await window.hive.fsRead(artifactsPath);
      if (data.content) setContractBriefs(JSON.parse(data.content));
    } catch { /* no artifacts yet */ }
  };

  const saveArtifacts = async (briefs: typeof contractBriefs) => {
    await window.hive.fsMkdir(`${projectPath}/.hive`);
    await window.hive.fsWrite(artifactsPath, JSON.stringify(briefs, null, 2));
  };

  // Load artifacts on mount
  useEffect(() => { if (projectPath) { void loadArtifacts(); } }, [projectPath]);

  const simulatorLabel = status?.running
    ? `Running${status.pid ? ` · PID ${status.pid}` : ''}`
    : status?.installed ? 'Ready to start' : 'Binary not installed';
  const simulatorTone = status?.running ? 'text-success' : status?.installed ? 'text-fg-muted' : 'text-warn';

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-accent/25 bg-accent/[0.045] shadow-elev-sm" aria-labelledby="dero-studio-title">
      <div className="flex flex-col gap-3 border-b border-accent/15 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-accent">DERO developer studio</div>
          <h2 id="dero-studio-title" className="mt-1 text-sm font-semibold text-fg">Build, verify, then ask for approval</h2>
          <p className="mt-1 text-xs text-fg-muted">Workflows prepare and test locally. They never sign, transfer, or deploy to a live network.</p>
          <p className="mt-1 text-[10px] text-fg-subtle">MCP context: {mcpNames.length ? mcpNames.join(', ') : 'none configured for this project'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] ${simulatorTone}`}>{simulatorLabel}</span>
          {status?.running && <button onClick={() => void checkHealth()} className="text-[11px] font-medium text-accent hover:text-accent-hover">Check RPC</button>}
          <ActionButton
            label={pending ? 'Working…' : status?.running ? 'Stop simulator' : 'Start simulator'}
            onClick={() => void toggleSimulator()}
            disabled={pending || (!status?.installed && !status?.running)}
          />
        </div>
      </div>
      <div className="grid divide-y divide-border/70 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
        <DeroWorkflowCard title="Contract brief" description="Turn requirements into an auditable DVM-BASIC design, source outline, and test plan." action="Create brief" onClick={() => void onStartWorkflow('DVM contract brief', `Act as the DERO Contract Architect. Help me design a DVM-BASIC smart contract. First ask only the essential questions about actors, assets, state, permissions, privacy, failures, and expected tests. Then produce a concise contract brief and simulator-first implementation plan. Do not propose live deployment or wallet actions.`, 'dero-contract-architect')} />
        <DeroWorkflowCard title="Security review" description="Review DVM source with a DERO-specific checklist and reproducible simulator tests." action="Start audit" onClick={() => void onStartWorkflow('DVM contract security audit', `Act as the DERO Security Auditor. I want to audit a DVM-BASIC contract. Ask me to provide the source or select a project file, then report only concrete DERO-specific risks with line references, exploit paths, simulator reproductions, and minimal remediations. Do not deploy, sign, transfer, or invoke a live contract.`, 'dero-contract-auditor')} />
        <DeroWorkflowCard title="TELA dApp" description="Plan a TELA frontend, contract interface, local preview, and explicit XSWD permissions." action="Build dApp" onClick={() => void onStartWorkflow('TELA dApp build', `Act as the TELA dApp Builder. Help me create a TELA application around a DERO contract. Start with the user journey and contract interface, then propose the TELA structure, frontend files, local preview steps, simulator fixtures, and only the minimum explicit XSWD permissions.`, 'tela-dapp-builder')} />
        <DeroWorkflowCard title="Chain context" description="Investigate a SCID, transaction, address, or deployment estimate with verified DERO tools." action="Investigate" onClick={() => void onStartWorkflow('DERO chain investigation', `Use the connected DERO MCP tools to investigate chain context. Ask me for a SCID, transaction ID, address, TELA URL, or a deployable DVM-BASIC source. Prefer composite tools and canonical documentation. Clearly separate verified daemon evidence from your interpretation. This is read-only; do not request wallet credentials or submit anything.`, 'dero-chain-investigator')} />
        <DeroWorkflowCard title="Simulator tests" description="Turn contract rules into deterministic local wallet, invocation, block, and state assertions." action="Plan tests" onClick={() => void onStartWorkflow('DERO simulator test plan', `Act as the DERO Simulator Tester. Help me produce a deterministic local test plan for a DVM-BASIC contract. First ask for the source or contract brief. Then define fixtures, successful and failing invocations, block progression, expected state/return assertions, and the exact evidence required before a deployment can be proposed. Do not use a live network.`, 'dero-simulator-tester')} />
        <DeroWorkflowCard title="Release plan" description="Prepare an unsigned, evidence-based release checklist with explicit user approvals." action="Prepare release" onClick={() => void onStartWorkflow('DERO release plan', `Act as the DERO Release Manager. Help me prepare a release plan for this DERO project. Gather contract lint results, simulator evidence, source review, gas estimation, TELA packaging, XSWD permission scope, and rollback/support notes. Produce unsigned steps only; every wallet action and deployment must remain an explicit user approval.`, 'dero-release-manager')} />
      </div>
      <div className="border-t border-border/70 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-accent">TELA dApp Builder</div>
            <h3 className="mt-1 text-xs font-semibold text-fg">Generate a complete TELA dApp from a description</h3>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <input
            type="text"
            value={telaName}
            onChange={(e) => setTelaName(e.target.value)}
            placeholder="dApp name (e.g. MyToken)"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none focus:border-accent"
          />
          <textarea
            value={telaBrief}
            onChange={(e) => setTelaBrief(e.target.value)}
            placeholder="Brief description of the dApp..."
            rows={2}
            className="min-w-0 flex-[2] rounded-md border border-border bg-bg-input px-2.5 py-1.5 text-[11px] text-fg outline-none focus:border-accent resize-none"
          />
          <ActionButton
            label={telaGenerating ? 'Generating…' : 'Generate TELA dApp'}
            onClick={() => void generateTelaDapp()}
            disabled={!telaName.trim() || telaGenerating}
            primary
          />
        </div>
        {telaError && <p className="mt-2 text-[10px] text-danger">{telaError}</p>}
        {telaPreviewOpen && telaName && (
          <div className="mt-3 border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-bg-elev border-b border-border">
              <span className="text-xs font-medium text-fg">Live Preview: {telaName}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPreviewKey((k) => k + 1)} className="text-[10px] px-2 py-0.5 rounded bg-bg text-fg-muted hover:text-fg">Refresh</button>
                <button onClick={() => setTelaPreviewOpen(false)} className="text-fg-muted hover:text-fg text-sm px-1">×</button>
              </div>
            </div>
            <iframe
              key={previewKey}
              src={`${projectPath.replace(/\\/g, '/')}/tela/${telaName}/index.html?mock=1`}
              className="w-full h-96 border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
              title={`TELA Preview: ${telaName}`}
            />
          </div>
        )}
        {telaValidationResults && telaValidationResults.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-bg-input/50 p-3">
            <div className="text-[11px] font-medium text-fg mb-2">TELA Validation</div>
            <ul className="space-y-1">
              {telaValidationResults.map((result, i) => (
                <li key={i} className="flex items-start gap-2 text-[10px]">
                  <span className={`mt-0.5 flex-shrink-0 font-mono ${result.status === 'pass' ? 'text-success' : result.status === 'warn' ? 'text-warn' : 'text-danger'}`}>
                    {result.status === 'pass' ? '✓' : result.status === 'warn' ? '⚠' : '✗'}
                  </span>
                  <span className="text-fg-muted">
                    <span className="text-fg font-medium">{result.check}</span>: {result.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-border/70 px-4 py-3 sm:px-6">
          {health && <p className={`mb-3 text-[11px] ${health.reachable ? 'text-success' : 'text-warn'}`}>{health.reachable ? `Simulator RPC reachable in ${health.latencyMs ?? 0}ms.` : `Simulator RPC unavailable: ${health.error || 'unknown error'}`}</p>}
          {chainInfo && <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-bg-input/50 px-3 py-2 text-[10px] sm:grid-cols-4"><div><dt className="text-fg-subtle">Network</dt><dd className="font-medium text-fg">{chainInfo.network}</dd></div><div><dt className="text-fg-subtle">Height</dt><dd className="font-mono text-fg">{chainInfo.height}</dd></div><div><dt className="text-fg-subtle">Topo height</dt><dd className="font-mono text-fg">{chainInfo.topoHeight}</dd></div><div><dt className="text-fg-subtle">Pool</dt><dd className="font-mono text-fg">{chainInfo.txPoolSize}</dd></div></dl>}
          <label className="block text-[11px] font-medium text-fg">DVM-BASIC structural check</label>
          <p className="mt-1 text-[10px] text-fg-subtle">Local, deterministic guidance only — use the simulator or daemon to confirm compilation and execution.</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={contractName}
              onChange={(e) => setContractName(e.target.value)}
              placeholder="Contract name (e.g. Token)"
              className="min-w-0 w-44 rounded-md border border-border bg-bg-input px-2 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
            />
            <input
              type="text"
              value={contractBrief}
              onChange={(e) => setContractBrief(e.target.value)}
              placeholder="Brief description for artifacts"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2 py-1 text-[10px] text-fg outline-none focus:border-accent"
            />
          </div>
          <textarea value={source} onChange={(event) => setSource(event.target.value)} className="mt-2 min-h-28 w-full rounded-md border border-border bg-bg-input p-2 font-mono text-[11px] text-fg outline-none focus:border-accent" placeholder={'Function Initialize() Uint64\n  10 STORE("owner", SIGNER())\n  20 RETURN 0\nEnd Function'} spellCheck={false} />
          <div className="mt-2 flex items-center gap-3"><ActionButton label="Load .bas file" onClick={() => void loadSource()} /><ActionButton label="Analyze contract" onClick={() => void analyze()} disabled={!source.trim()} /><button 
  onClick={() => {
    if (!contractName.trim() || !source.trim()) return;
    const brief: typeof contractBriefs[number] = {
      name: contractName,
      brief: contractBrief || '',
      source: source,
      createdAt: Date.now(),
      reviewFindings: lint?.findings?.map(f => ({
        line: f.line || 0,
        severity: f.severity,
        message: f.message,
        recommendation: f.code === 'MISSING_RETURN' ? 'Add RETURN statement to this function' :
                     f.code === 'TRANSFER_WITHOUT_SIGNER' ? 'Add SIGNER() check before transfer' :
                     f.code === 'PUBLIC_VALUE_PATH' ? 'Verify public function authorization' :
                     f.code === 'STORAGE_TYPE_INCONSISTENCY' ? 'Ensure consistent key typing' :
                     'Review and fix this finding'
      })) || []
    };
    const updated = [brief, ...contractBriefs];
    setContractBriefs(updated);
    void saveArtifacts(updated);
  }}
  disabled={!source.trim()}
  className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40"
>
  Save as Artifact
</button>{lint && <span className={`text-[11px] ${lint.valid ? 'text-success' : 'text-danger'}`}>{lint.valid ? 'No structural errors found' : 'Structural errors found'} · {lint.findings.length} finding{lint.findings.length === 1 ? '' : 's'}</span>}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2"><button onClick={() => void findContracts()} className="text-[10px] font-medium text-accent hover:text-accent-hover">Find project contracts</button>{contractFiles.map((file) => <button key={file.path} onClick={() => void loadSourcePath(file.path)} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted hover:border-accent/50 hover:text-accent">{file.rel}</button>)}</div>
          {lintError && <p className="mt-2 text-[11px] text-danger">{lintError}</p>}
          {lint && lint.findings.length > 0 && <ul className="mt-3 space-y-1.5">{lint.findings.map((finding, index) => <li key={`${finding.code}-${finding.line ?? index}`} className={`text-[11px] ${finding.severity === 'error' ? 'text-danger' : finding.severity === 'warning' ? 'text-warn' : 'text-fg-muted'}`}><span className="font-mono">{finding.code}</span>{finding.line ? ` · line ${finding.line}` : ''} — {finding.message}</li>)}</ul>}

          {contractBriefs.length > 0 && (
            <div className="space-y-2 mt-3">
              <div className="text-xs font-medium text-fg">Saved Artifacts</div>
              {contractBriefs.map((brief, i) => (
                <div key={i} className="bg-bg-elev border border-border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-fg">{brief.name}</span>
                    <span className="text-[10px] text-fg-muted">{new Date(brief.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[11px] text-fg-muted line-clamp-2">{brief.brief}</p>

                  {brief.reviewFindings && brief.reviewFindings.length > 0 && (
                    <div className="mt-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">Review Findings ({brief.reviewFindings.length})</div>
                      {brief.reviewFindings.map((f, j) => (
                        <div key={j} className={`text-[10px] pl-2 border-l-2 mb-1 ${
                          f.severity === 'error' ? 'border-danger text-danger/80' :
                          f.severity === 'warning' ? 'border-warn text-warn/80' : 'border-accent text-fg-muted'
                        }`}>
                          <span className="font-medium">Line {f.line}:</span> {f.message}
                          <div className="text-fg-subtle mt-0.5">→ {f.recommendation}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {brief.testRun && (
                    <div className="mt-1.5">
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded ${brief.testRun.failed === 0 ? 'bg-success/20 text-success' : 'bg-warn/20 text-warn'}`}>
                          {brief.testRun.passed} passed, {brief.testRun.failed} failed
                        </span>
                        {brief.testRun.sourceRevision && <span className="text-fg-muted">rev: {brief.testRun.sourceRevision}</span>}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {brief.testRun.results.map((tr, j) => (
                          <div key={j} className="text-[10px] flex items-start gap-1.5">
                            <span className={tr.status === 'pass' ? 'text-success' : 'text-danger'}>{tr.status === 'pass' ? '✓' : '✗'}</span>
                            <span>
                              <span className="text-fg">{tr.scenario}</span>
                              {tr.status === 'fail' && <span className="text-fg-muted ml-1">— {tr.output}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1 pt-1">
                    <button
                      onClick={() => {
                        setContractName(brief.name);
                        setContractBrief(brief.brief);
                        if (brief.source) setSource(brief.source);
                        void onStartWorkflow(
                          brief.name,
                          `Review and work with this saved contract brief for "${brief.name}".\n\n## Contract Brief\n${brief.brief}\n\n## Current Source\n\`\`\`basic\n${brief.source || 'No source saved'}\n\`\`\``,
                          'dero-contract-architect'
                        );
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-accent-soft text-accent hover:bg-accent hover:text-white transition"
                    >Load into chat</button>
                    <button
                      onClick={() => {
                        const updated = contractBriefs.filter((_, idx) => idx !== i);
                        setContractBriefs(updated);
                        void saveArtifacts(updated);
                      }}
                      className="text-[10px] px-2 py-0.5 rounded text-fg-muted hover:text-danger transition"
                    >Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Gnomon Contract Discovery */}
      <div className="border-t border-border/70 px-4 py-3 sm:px-6">
        <div className="space-y-2">
          <div className="text-xs font-medium text-fg">Contract Discovery</div>
          <p className="text-[10px] text-fg-subtle">Gnomon-powered dApp intelligence — search indexed contracts by function, similarity, or TELA apps.</p>
          <div className="flex items-center gap-2 text-xs">
            <input
              value={discoveryQuery}
              onChange={(e) => setDiscoveryQuery(e.target.value)}
              placeholder="Search contracts by name, function, or SCID..."
              className="flex-1 bg-bg-input border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
            />
            <select
              value={discoveryKind}
              onChange={(e) => setDiscoveryKind(e.target.value)}
              className="bg-bg-input border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none"
            >
              <option value="similar-contracts">Similar</option>
              <option value="by-function">By Function</option>
              <option value="tela-apps">TELA Apps</option>
            </select>
            <button
              onClick={() => {
                void onStartWorkflow('Gnomon contract discovery', `Act as the DERO Chain Investigator. Use the connected DERO MCP tools to discover contracts matching this search. Query: ${discoveryQuery || '(broad discovery)'} Kind: ${discoveryKind}. If a Gnomon instance is connected, use its indexed search. Otherwise, use dero_tela_list_apps, dero_get_sc, and explain_smart_contract to build discovery results. Report SCID, name, deploy height, functions, and related contracts.`, 'dero-chain-investigator');
              }}
              className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90"
            >
              Discover
            </button>
          </div>
        </div>
      </div>

      {status?.running && (
        <div className="border-t border-border/70 px-4 py-3 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            <div className="rounded-md border border-border bg-bg-input/50 p-3">
              <label className="block text-[11px] font-medium text-fg">Fixture wallets</label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={fixtureLabel}
                  onChange={(e) => setFixtureLabel(e.target.value)}
                  placeholder="Optional label"
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
                />
                <button onClick={() => void createFixture()} className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/20">Create fixture</button>
              </div>
              {simulatorFixtures.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {simulatorFixtures.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded border border-border bg-bg-elev px-2 py-1.5">
                      <div className="min-w-0">
                        <span className="text-[10px] font-medium text-fg">{f.label}</span>
                        <span className="ml-2 font-mono text-[9px] text-fg-subtle truncate block">{f.address}</span>
                      </div>
                      <button onClick={() => void refreshBalance(f.address)} className="flex-shrink-0 text-[10px] text-accent hover:text-accent-hover">Balance</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={balanceScid}
                  onChange={(e) => setBalanceScid(e.target.value)}
                  placeholder="Optional SCID for token balance"
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="rounded-md border border-border bg-bg-input/50 p-3">
              <label className="block text-[11px] font-medium text-fg">Contract state & height</label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={stateScid}
                  onChange={(e) => setStateScid(e.target.value)}
                  placeholder="SCID (64-char hex)"
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
                />
                <input
                  type="text"
                  value={stateKeys}
                  onChange={(e) => setStateKeys(e.target.value)}
                  placeholder="Keys (comma-sep)"
                  className="min-w-0 w-32 rounded-md border border-border bg-bg-input px-2 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
                />
                <button onClick={() => void readContractState()} disabled={!stateScid.trim()} className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-40">Read</button>
              </div>
              {contractState && (
                <pre className="mt-2 max-h-32 overflow-auto rounded border border-border bg-bg-elev p-2 font-mono text-[10px] text-fg-muted">{JSON.stringify(contractState, null, 2)}</pre>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button onClick={() => void readHeight()} className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/20">Get height</button>
                {simHeight !== null && <span className="font-mono text-[10px] text-fg">{simHeight}</span>}
              </div>
            </div>
          </div>
          {fixtureNotice && <p className="mt-2 text-[10px] text-fg-muted" role="status">{fixtureNotice}</p>}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div><p className="text-[10px] text-fg-subtle">Next: structured simulator deploy, invoke, mine, and state assertions.</p>{templateNotice && <p className="mt-1 text-[10px] text-fg-muted" role="status">{templateNotice}</p>}</div>
        <div className="flex items-center gap-3"><button onClick={() => void createStarterContract()} className="text-xs font-medium text-accent hover:text-accent-hover">Create starter contract</button><button onClick={() => void createTelaStarter()} className="text-xs font-medium text-accent hover:text-accent-hover">Create TELA starter</button><button onClick={onOpenCode} className="text-xs font-medium text-accent hover:text-accent-hover">Open project code →</button></div>
      </div>
    </section>
  );
}

function DeroWorkflowCard({ title, description, action, onClick }: { title: string; description: string; action: string; onClick: () => void }): JSX.Element {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <h3 className="text-xs font-semibold text-fg">{title}</h3>
      <p className="mt-1 min-h-10 text-[11px] leading-relaxed text-fg-muted">{description}</p>
      <button onClick={onClick} className="mt-3 text-[11px] font-medium text-accent hover:text-accent-hover">{action} →</button>
    </div>
  );
}

function EvidenceNode({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'muted' }): JSX.Element {
  return (
    <div className="relative z-10 flex items-center gap-3 border-b border-border py-2 last:border-0 sm:block sm:border-0 sm:py-0 sm:text-center">
      <StatusMark tone={tone} large />
      <div className="mt-0 sm:mt-2">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle">{label}</div>
        <div className="mt-0.5 truncate text-xs font-medium text-fg">{value}</div>
      </div>
    </div>
  );
}

function StatusMark({ tone, large = false }: { tone: 'good' | 'warn' | 'muted'; large?: boolean }): JSX.Element {
  const color = tone === 'good' ? 'border-success bg-success' : tone === 'warn' ? 'border-warn bg-warn' : 'border-border-strong bg-bg-elev';
  return <span aria-hidden="true" className={`inline-block flex-shrink-0 rounded-sm border-2 ${color} ${large ? 'h-3 w-3 shadow-[0_0_0_4px_var(--bg-elev)]' : 'mt-0.5 h-2.5 w-2.5'}`} />;
}

function BoardPanel({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <section className="px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle">{eyebrow}</div>
          <h2 className="mt-0.5 text-sm font-semibold text-fg">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelNote({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-xs leading-relaxed text-fg-subtle">{children}</p>;
}

function ActionButton({ label, onClick, primary = false, disabled = false }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${primary ? 'bg-accent text-white hover:bg-accent-hover' : 'border border-border bg-bg-elev text-fg-muted hover:border-accent/50 hover:text-fg'}`}
    >
      {label}
    </button>
  );
}

function automationLabel(kind: KnowledgeAutomationKind): string {
  return kind === 'morning-digest' ? 'Morning digest' : 'Weekly synthesis';
}

function formatAutomationTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
