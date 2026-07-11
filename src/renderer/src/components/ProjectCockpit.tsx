import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IntegrationStatus, ProjectKnowledgeStatus, SimulatorStatus, SwarmRun } from '@shared/types';
import { swarmTeamSummary } from '@shared/swarm';
import { useAppStore } from '../stores/app';

interface GitEvidence {
  state: 'loading' | 'ready' | 'missing' | 'error';
  branch?: string;
  changes?: number;
  commit?: string;
  subject?: string;
  error?: string;
}

type ActivityItem =
  | { kind: 'conversation'; id: string; title: string; detail: string; updatedAt: number }
  | { kind: 'swarm'; id: string; title: string; detail: string; updatedAt: number; run: SwarmRun };

export function ProjectCockpit({ projectId }: { projectId: string }): JSX.Element {
  const project = useAppStore((state) => state.projects.find((item) => item.id === projectId));
  const conversations = useAppStore((state) => state.conversations);
  const swarmRuns = useAppStore((state) => Object.values(state.swarmRuns));
  const mcpStatuses = useAppStore((state) => state.mcpStatuses);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const createConversation = useAppStore((state) => state.createConversation);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const closeCockpit = useAppStore((state) => state.closeProjectCockpit);
  const openProjectSettings = useAppStore((state) => state.openProjectSettings);
  const [git, setGit] = useState<GitEvidence>({ state: 'loading' });
  const [simulator, setSimulator] = useState<SimulatorStatus | null>(null);
  const [simulatorBusy, setSimulatorBusy] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [knowledge, setKnowledge] = useState<ProjectKnowledgeStatus | null>(null);

  const projectConversations = useMemo(
    () => conversations.filter((item) => item.projectId === projectId && !item.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, projectId]
  );
  const conversationIds = useMemo(() => new Set(projectConversations.map((item) => item.id)), [projectConversations]);
  const projectSwarms = useMemo(
    () => swarmRuns
      .filter((run) => run.projectId === projectId || (!!run.conversationId && conversationIds.has(run.conversationId)))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [swarmRuns, projectId, conversationIds]
  );

  const activity = useMemo<ActivityItem[]>(() => [
    ...projectConversations.map((conversation) => ({
      kind: 'conversation' as const,
      id: conversation.id,
      title: conversation.title,
      detail: `${conversation.messageCount} messages${conversation.preview ? ` · ${conversation.preview}` : ''}`,
      updatedAt: conversation.updatedAt
    })),
    ...projectSwarms.map((run) => ({
      kind: 'swarm' as const,
      id: run.id,
      title: run.prompt,
      detail: `${swarmTeamSummary(run.workerCount)} · ${run.status.replaceAll('_', ' ')}`,
      updatedAt: run.updatedAt,
      run
    }))
  ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [projectConversations, projectSwarms]);

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
    void window.hive.simulatorStatus().then((status) => { if (!cancelled) setSimulator(status); }).catch(() => {});
    void window.hive.integrationList().then((statuses) => { if (!cancelled) setIntegrations(statuses); }).catch(() => {});
    void window.hive.knowledgeStatus?.(projectId).then((status) => { if (!cancelled) setKnowledge(status); }).catch(() => {});
    const offSimulator = window.hive.onSimulatorStatus((status) => setSimulator(status));
    const offIntegrations = window.hive.onIntegrationChanged((status) => {
      setIntegrations((current) => [...current.filter((item) => item.id !== status.id), status]);
    });
    return () => { cancelled = true; offSimulator(); offIntegrations(); };
  }, [projectId]);

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

  const kind = project.config?.kind || 'general';
  const assignedMcp = mcpStatuses.filter((server) => project.config?.mcpServerIds?.includes(server.id));
  const connectedMcp = assignedMcp.filter((server) => server.connected).length;
  const vaultServer = mcpStatuses.find((server) => server.id === project.config?.knowledge?.serverId);
  const vaultConfigured = !!project.config?.knowledge?.serverId && !!project.config?.knowledge?.folder;
  const vaultState = knowledge?.state || (vaultConfigured ? (vaultServer?.connected ? 'ready' : 'offline') : 'unconfigured');

  const enterProjectChat = async (title = 'New chat'): Promise<string> => {
    const existing = projectConversations[0];
    if (existing) {
      await selectConversation(existing.id);
      return existing.id;
    }
    return createConversation({ title, projectId });
  };

  const newChat = async (): Promise<void> => {
    await createConversation({ title: 'New chat', projectId });
  };

  const openCode = async (): Promise<void> => {
    await updateSettings({ codeFolder: project.path });
    const state = useAppStore.getState();
    if (!state.codeTabOpen) state.toggleCodeTab();
  };

  const prepareResearch = async (): Promise<void> => {
    await createConversation({ title: `/dero-research ${project.name}`, projectId });
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<string>('hive:companion-compose', { detail: '/dero-research ' }));
    }, 0);
  };

  const launchSwarm = async (): Promise<void> => {
    await enterProjectChat('Project swarm');
    useAppStore.getState().openSwarm(`Investigate ${project.name} in ${project.path}. `);
  };

  const toggleSimulator = async (): Promise<void> => {
    if (simulatorBusy) return;
    setSimulatorBusy(true);
    try {
      setSimulator(simulator?.running ? await window.hive.simulatorStop() : await window.hive.simulatorStart());
    } finally {
      setSimulatorBusy(false);
    }
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-bg" aria-labelledby="project-cockpit-title">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <button onClick={closeCockpit} className="mb-3 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.16em] text-fg-subtle hover:text-accent">
              <span aria-hidden="true">←</span> Chat workspace
            </button>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elev text-xl shadow-elev-sm">{project.icon || '📁'}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 id="project-cockpit-title" className="truncate text-2xl font-semibold tracking-tight text-fg">{project.name}</h1>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${kind === 'dero' ? 'border-accent/35 bg-accent-soft text-accent' : 'border-border text-fg-subtle'}`}>{kind}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-fg-subtle" title={project.path}>{project.path}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="New chat" onClick={() => void newChat()} />
            <ActionButton label="Open code" onClick={() => void openCode()} />
            <ActionButton label="Launch swarm" onClick={() => void launchSwarm()} primary />
          </div>
        </header>

        <section className="overflow-hidden rounded-xl border border-border bg-bg-elev shadow-elev-sm" aria-label="Project evidence board">
          <div className="relative grid gap-0 px-4 py-4 sm:grid-cols-4 sm:px-6">
            <div className="absolute left-[12.5%] right-[12.5%] top-[30px] hidden border-t border-border sm:block" aria-hidden="true" />
            <EvidenceNode label="Git" value={git.state === 'ready' ? git.branch || 'detached' : git.state === 'loading' ? 'checking' : 'not linked'} tone={git.state === 'ready' ? (git.changes ? 'warn' : 'good') : 'muted'} />
            <EvidenceNode label="Working set" value={`${projectConversations.length} thread${projectConversations.length === 1 ? '' : 's'}`} tone={projectConversations.length ? 'good' : 'muted'} />
            <EvidenceNode label="Vault" value={vaultState === 'ready' ? 'linked' : vaultState.replaceAll('_', ' ')} tone={vaultState === 'ready' ? 'good' : vaultState === 'error' || vaultState === 'offline' ? 'warn' : 'muted'} />
            <EvidenceNode label="Project MCP" value={`${connectedMcp}/${assignedMcp.length} online`} tone={assignedMcp.length && connectedMcp === assignedMcp.length ? 'good' : assignedMcp.length ? 'warn' : 'muted'} />
          </div>

          <div className="grid border-t border-border lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
            <div className="min-w-0 lg:border-r lg:border-border">
              {kind === 'dero' && (
                <section className="border-b border-border bg-accent-soft/50 px-4 py-5 sm:px-6" aria-labelledby="dero-studio-title">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="max-w-xl">
                      <div className="font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-accent">DERO studio / evidence mode</div>
                      <h2 id="dero-studio-title" className="mt-1 text-lg font-semibold tracking-tight text-fg">Move from chain question to reviewed evidence.</h2>
                      <p className="mt-1 text-xs leading-relaxed text-fg-muted">Research across the vault, live chain sources, and this codebase; run locally; then ask the five-role Swarm to challenge the result.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:max-w-xs sm:justify-end">
                      <ActionButton label="DERO research" onClick={() => void prepareResearch()} primary />
                      <ActionButton
                        label={simulatorBusy ? 'Updating…' : simulator?.running ? 'Stop simulator' : 'Start simulator'}
                        onClick={() => void toggleSimulator()}
                        disabled={simulatorBusy || (!simulator?.installed && !simulator?.running)}
                      />
                    </div>
                  </div>
                </section>
              )}

              <section className="px-4 py-5 sm:px-6" aria-labelledby="working-set-title">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-subtle">Recent evidence</div>
                    <h2 id="working-set-title" className="mt-0.5 text-sm font-semibold text-fg">Working set</h2>
                  </div>
                  <span className="font-mono text-[10px] text-fg-subtle">{activity.length.toString().padStart(2, '0')} records</span>
                </div>
                {activity.length === 0 ? (
                  <div className="border-l-2 border-border py-4 pl-4">
                    <p className="text-xs font-medium text-fg">No project work yet</p>
                    <p className="mt-1 text-xs text-fg-subtle">Start a chat or launch a Swarm to create the first record.</p>
                  </div>
                ) : (
                  <ol className="divide-y divide-border border-y border-border">
                    {activity.map((item) => (
                      <li key={`${item.kind}-${item.id}`}>
                        <button
                          onClick={() => item.kind === 'conversation' ? void selectConversation(item.id) : item.run.conversationId ? void selectConversation(item.run.conversationId) : undefined}
                          disabled={item.kind === 'swarm' && !item.run.conversationId}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 text-left hover:bg-bg-input/60 disabled:cursor-default"
                        >
                          <span className={`h-2 w-2 rounded-sm ${item.kind === 'swarm' ? 'bg-accent' : 'border border-border-strong bg-bg-elev'}`} />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-fg">{item.title}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-fg-subtle">{item.detail}</span>
                          </span>
                          <span className="font-mono text-[9px] text-fg-subtle">{relativeTime(item.updatedAt)}</span>
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
                  <StatusMark tone={vaultState === 'ready' ? 'good' : vaultState === 'offline' || vaultState === 'error' ? 'warn' : 'muted'} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-fg">{vaultState === 'ready' ? 'Vault ready' : vaultState === 'offline' ? 'Server offline' : vaultState === 'error' ? 'Vault error' : 'Vault not linked'}</p>
                    <p className="mt-1 truncate font-mono text-[10px] text-fg-subtle">{project.config?.knowledge?.folder || 'Choose a server and folder'}</p>
                    {typeof knowledge?.noteCount === 'number' && <p className="mt-1 text-[10px] text-fg-muted">{knowledge.noteCount.toLocaleString()} indexed notes</p>}
                    {knowledge?.error && <p className="mt-1 text-[10px] text-danger">{knowledge.error}</p>}
                  </div>
                </div>
              </BoardPanel>

              <BoardPanel eyebrow="Runtime" title="MCP & integrations" action={<button onClick={openProjectSettings} className="text-[10px] text-fg-subtle hover:text-accent">Assign</button>}>
                <div className="space-y-2">
                  {assignedMcp.length === 0 && integrations.length === 0 && <PanelNote>No services assigned to this project.</PanelNote>}
                  {assignedMcp.map((server) => (
                    <HealthRow key={server.id} label={server.name} detail={server.connected ? `${server.tools.length} tools` : server.error || 'offline'} good={server.connected} />
                  ))}
                  {integrations.map((integration) => (
                    <HealthRow key={integration.id} label={integration.name} detail={integration.running ? 'running' : integration.installed ? 'stopped' : 'not installed'} good={integration.running} />
                  ))}
                </div>
              </BoardPanel>

              <BoardPanel eyebrow="Profile" title="Project controls">
                <p className="text-xs leading-relaxed text-fg-muted">Kind, vault routing, and the MCP allowlist live with this project.</p>
                <button onClick={openProjectSettings} className="mt-3 rounded-md border border-border bg-bg-input px-2.5 py-1.5 text-xs font-medium text-fg hover:border-accent/50 hover:text-accent">Edit project settings</button>
              </BoardPanel>
            </aside>
          </div>
        </section>
      </div>
    </main>
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

function HealthRow({ label, detail, good }: { label: string; detail: string; good: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${good ? 'bg-success' : 'bg-fg-subtle'}`} />
      <span className="min-w-0 flex-1 truncate text-fg-muted">{label}</span>
      <span className="max-w-[8rem] truncate font-mono text-[9px] text-fg-subtle">{detail}</span>
    </div>
  );
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
