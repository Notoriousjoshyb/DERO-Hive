import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { SimulatorPanel } from './SimulatorPanel';
import type { Conversation, Project, Message } from '@shared/types';

// Update checker stays hidden until the repo has its first GitHub release.
const SHOW_UPDATE_CHECKER = false;

export function Sidebar(): JSX.Element {
  const conversations = useAppStore((s) => s.conversations);
  const projects = useAppStore((s) => s.projects);
  const currentId = useAppStore((s) => s.currentConversationId);
  const createConversation = useAppStore((s) => s.createConversation);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const updateConversation = useAppStore((s) => s.updateConversation);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const loadProjects = useAppStore((s) => s.loadProjects);
  const saveProject = useAppStore((s) => s.saveProject);
  const codeTabOpen = useAppStore((s) => s.codeTabOpen);
  const toggleCodeTab = useAppStore((s) => s.toggleCodeTab);
  const visionTabOpen = useAppStore((s) => s.visionTabOpen);
  const toggleVisionTab = useAppStore((s) => s.toggleVisionTab);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Array<{ conversationId: string; snippet: string; role: string }>>([]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await window.hive.convSearch(search);
        setResults(r || []);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  // Opening or creating a chat must land the user in the chat view — close
  // any full-view tab (Code/Vision) occupying the main column.
  const backToChat = (): void => {
    const s = useAppStore.getState();
    if (s.codeTabOpen) s.toggleCodeTab();
    else if (s.visionTabOpen) s.toggleVisionTab();
  };

  const handleNew = async (projectId?: string): Promise<void> => {
    backToChat();
    const id = await createConversation({ title: 'New chat', projectId });
    await selectConversation(id);
  };

  const toggleProject = (projectId: string): void => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleBrowseProject = async (): Promise<void> => {
    const dir = await window.hive.fsPickDirectory();
    if (!dir) return;
    setNewProjectPath(dir);
    if (!newProjectName) {
      const parts = dir.split(/[/\\]/).filter(Boolean);
      setNewProjectName(parts[parts.length - 1] || 'Project');
    }
  };

  const handleSaveProject = async (): Promise<void> => {
    if (!newProjectName.trim() || !newProjectPath.trim()) return;
    const project: Project = {
      id: crypto.randomUUID(),
      name: newProjectName.trim(),
      icon: '📁',
      path: newProjectPath.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await saveProject(project);
    setNewProjectName('');
    setNewProjectPath('');
    setAddingProject(false);
  };

  const handleCancelProject = (): void => {
    setNewProjectName('');
    setNewProjectPath('');
    setAddingProject(false);
  };

  const onSelect = async (id: string): Promise<void> => { backToChat(); await selectConversation(id); };
  const onDelete = async (id: string): Promise<void> => { await deleteConversation(id); };
  const onTogglePin = async (id: string, pinned: boolean): Promise<void> => {
    await updateConversation(id, { pinned });
  };
  const onRename = async (id: string, title: string): Promise<void> => {
    await updateConversation(id, { title });
  };
  const onArchive = async (id: string): Promise<void> => {
    await updateConversation(id, { archived: true });
  };
  const onUnarchive = async (id: string): Promise<void> => {
    await updateConversation(id, { archived: false });
  };
  const onMoveToProject = async (id: string, projectId?: string): Promise<void> => {
    await updateConversation(id, { projectId });
  };

  const activeConvs = conversations.filter((c) => !c.archived);
  const archivedConvs = conversations.filter((c) => c.archived);
  const pinnedConvs = activeConvs.filter((c) => c.pinned);
  // Chats that belong to a project live under that project — keep them out of
  // Recents so they don't appear duplicated in two places.
  const recentConvs = activeConvs.filter((c) => !c.pinned && !c.projectId);

  const goHome = (): void => {
    if (codeTabOpen) toggleCodeTab();
    if (useAppStore.getState().visionTabOpen) useAppStore.getState().toggleVisionTab();
  };
  const goCode = (): void => { if (!codeTabOpen) toggleCodeTab(); };
  const goVision = (): void => { if (!visionTabOpen) toggleVisionTab(); };

  return (
    <aside
      data-sidebar-panel
      className="w-64 flex-shrink-0 bg-bg-sidebar border-r border-border flex flex-col h-full text-[13px]"
    >
      {/* Header: Home/Code + search */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex-1 bg-bg-elev rounded-lg p-0.5 flex items-center border border-border">
          <button
            onClick={goHome}
            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition ${
              !codeTabOpen && !visionTabOpen ? 'bg-bg-input text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            Home
          </button>
          <button
            onClick={goCode}
            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition ${
              codeTabOpen ? 'bg-bg-input text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            Code
          </button>
          <button
            onClick={goVision}
            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition ${
              visionTabOpen ? 'bg-bg-input text-fg shadow-sm' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            Vision
          </button>
        </div>
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className={`p-1.5 rounded-md hover:bg-bg-elev titlebar-no-drag ${searchOpen ? 'text-fg bg-bg-elev' : 'text-fg-subtle hover:text-fg'}`}
          title="Search"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4" />
            <path d="M11 11l-2.5-2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <button
          onClick={() => void handleNew()}
          className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-accent/25 bg-accent-soft text-accent hover:border-accent/50 hover:bg-accent hover:text-white transition-all duration-150 text-[13px] font-medium shadow-elev-sm"
          title="New chat (Ctrl+Shift+O)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
          New chat
        </button>
      </div>

      {/* Nav links */}
      <div className="px-3 pb-2 space-y-0.5">
        <NavItem
          icon={<ProjectsIcon />}
          label="Projects"
          onClick={() => setProjectsExpanded((v) => !v)}
          active={projectsExpanded}
        />
      </div>

      {/* Search */}
      {searchOpen && (
        <div className="px-3 pb-2">
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="6" cy="6" r="4" />
              <path d="M11 11l-2.5-2.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              autoFocus
              className="w-full pl-7 pr-2 py-1.5 bg-bg-elev border border-border rounded-md text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent/60 transition"
            />
          </div>
        </div>
      )}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-3 min-h-0">
        {search.trim() ? (
          <SearchResults results={results} onSelect={(id) => { void onSelect(id); setSearch(''); }} />
        ) : (
          <>
            {pinnedConvs.length > 0 && (
              <Section title="Pinned">
                <div className="space-y-0.5">
                  {pinnedConvs.map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={c.id === currentId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                      onTogglePin={() => onTogglePin(c.id, !c.pinned)}
                      onRename={(t) => onRename(c.id, t)}
                      onArchive={() => onArchive(c.id)}
                      onMoveToProject={(pid) => onMoveToProject(c.id, pid)}
                      projects={projects}
                    />
                  ))}
                </div>
              </Section>
            )}

            {recentConvs.length > 0 && (
              <Section
                title="Recents"
                action={
                  <button className="text-fg-subtle hover:text-fg p-0.5 rounded" title="Sort / filter">
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 4.5h10M2 9h10" />
                      <circle cx="5" cy="4.5" r="1.5" fill="currentColor" />
                      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
                    </svg>
                  </button>
                }
              >
                <div className="space-y-0.5">
                  {recentConvs.map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={c.id === currentId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                      onTogglePin={() => onTogglePin(c.id, !c.pinned)}
                      onRename={(t) => onRename(c.id, t)}
                      onArchive={() => onArchive(c.id)}
                      onMoveToProject={(pid) => onMoveToProject(c.id, pid)}
                      projects={projects}
                    />
                  ))}
                </div>
              </Section>
            )}

            {activeConvs.length === 0 && !projectsExpanded && (
              <div className="px-3 py-6 text-center text-xs text-fg-subtle">
                <div className="mb-1">No chats yet</div>
                <button onClick={() => void handleNew()} className="text-accent hover:underline">
                  Start your first chat →
                </button>
              </div>
            )}

            <ProjectsSection
              projects={projects}
              expanded={expandedProjects}
              toggleProject={toggleProject}
              addingProject={addingProject}
              setAddingProject={setAddingProject}
              newProjectName={newProjectName}
              setNewProjectName={setNewProjectName}
              newProjectPath={newProjectPath}
              setNewProjectPath={setNewProjectPath}
              handleBrowseProject={handleBrowseProject}
              handleSaveProject={handleSaveProject}
              handleCancelProject={handleCancelProject}
              conversations={activeConvs.filter((c) => c.projectId)}
              onNewChatInProject={handleNew}
              onSelectConversation={onSelect}
              onDeleteConversation={onDelete}
              onTogglePin={onTogglePin}
              onRename={onRename}
              onArchive={onArchive}
              onMoveToProject={onMoveToProject}
              currentId={currentId}
              isOpen={projectsExpanded}
            />

            {archivedConvs.length > 0 && (
              <ArchivedSection
                conversations={archivedConvs}
                currentId={currentId}
                onSelect={onSelect}
                onUnarchive={onUnarchive}
                onDelete={onDelete}
              />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <SimulatorPanel />
      <div className="border-t border-border p-3 space-y-1.5">
        {/* Hidden until the first GitHub release is published — flip to true
            (or just remove the guard) when ready to ship updates. */}
        {SHOW_UPDATE_CHECKER && <UpdateChecker />}
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center justify-center px-2 py-1.5 rounded-md hover:bg-bg-elev text-fg-subtle hover:text-fg transition"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center justify-between">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function NavItem({
  icon,
  label,
  badge,
  disabled,
  active,
  onClick,
  title
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition text-[13px] ${
        disabled
          ? 'text-fg-subtle/50 cursor-not-allowed'
          : active
          ? 'bg-bg-elev text-fg'
          : 'text-fg-muted hover:bg-bg-elev hover:text-fg'
      }`}
    >
      <span className="text-fg-subtle">{icon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {badge && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-bg-elev border border-border text-fg-subtle">{badge}</span>}
    </button>
  );
}

function ProjectsIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M2 3.5h10L11 11.5H3L2 3.5z" />
      <path d="M5 3.5V2.5a1 1 0 011-1h2a1 1 0 011 1v1" />
    </svg>
  );
}

function ConvItem({
  conv,
  active,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onArchive,
  onMoveToProject,
  projects
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onMoveToProject: (projectId?: string) => void;
  projects: Project[];
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const [moveOpen, setMoveOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const handleRename = (): void => {
    if (editing) {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== conv.title) onRename(trimmed);
      setEditing(false);
    } else {
      setDraft(conv.title);
      setEditing(true);
    }
  };

  const handleExportMarkdown = async (): Promise<void> => {
    try {
      const data = await window.hive.convGet(conv.id);
      if (!data?.messages) return;
      const md = conversationToMarkdown(data.title, data.messages);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conv.title || 'Untitled'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeMenus = (): void => {
    setMenuOpen(false);
    setMoveOpen(false);
    setContextMenu(null);
  };

  return (
    <div className="relative group" onContextMenu={handleContextMenu}>
      {editing ? (
        <div className="px-2 py-1 bg-bg-elev rounded-md">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              else if (e.key === 'Escape') { setDraft(conv.title); setEditing(false); }
            }}
            onBlur={handleRename}
            autoFocus
            className="w-full bg-bg-input border border-accent/50 rounded px-1.5 py-0.5 text-xs text-fg focus:outline-none"
          />
        </div>
      ) : (
        <button
          onClick={onSelect}
          className={`relative w-full text-left px-2 py-1.5 rounded-md transition-colors duration-100 flex items-center gap-2 ${
            active ? 'bg-bg-elev text-fg shadow-elev-sm' : 'text-fg-muted hover:bg-bg-elev/70 hover:text-fg'
          }`}
        >
          {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3.5 rounded-full bg-accent" />}
          <span className={`flex-shrink-0 ${active ? 'text-accent' : 'text-fg-subtle'}`}>
            {conv.pinned ? <PinIcon /> : <ChatIcon />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="truncate text-xs">{conv.title || 'Untitled'}</div>
          </div>
        </button>
      )}
      {!editing && (
        <button
          ref={moreButtonRef}
          onClick={(e) => {
            e.stopPropagation();
            if (!menuOpen && moreButtonRef.current) {
              const rect = moreButtonRef.current.getBoundingClientRect();
              setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
            }
            setMenuOpen((v) => !v);
          }}
          className={`absolute right-1 top-1.5 p-1 rounded text-fg-subtle hover:text-fg hover:bg-bg-input transition ${menuOpen ? 'bg-bg-input opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title="More actions"
          aria-label="More actions"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3" cy="6" r="1.2" />
            <circle cx="6" cy="6" r="1.2" />
            <circle cx="9" cy="6" r="1.2" />
          </svg>
        </button>
      )}
      {menuOpen && menuPos && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => { closeMenus(); }} />
          <div
            className="fixed z-50 menu-panel py-1 min-w-44 text-xs"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <MenuButton
              icon={<RenameIcon />}
              label="Rename"
              onClick={() => { setMenuOpen(false); handleRename(); }}
            />
            <MenuButton
              icon={<PinIcon />}
              label={conv.pinned ? 'Unpin' : 'Pin'}
              onClick={() => { onTogglePin(); setMenuOpen(false); }}
            />
            <MenuButton
              icon={<ArchiveIcon />}
              label="Archive"
              onClick={() => { onArchive(); setMenuOpen(false); }}
            />
            <div className="relative">
              <MenuButton
                icon={<MoveIcon />}
                label="Move to project"
                hasSubmenu
                onClick={() => setMoveOpen(!moveOpen)}
              />
              {moveOpen && (
                <div className="absolute left-full top-0 ml-1 menu-panel py-1 min-w-36 max-h-48 overflow-y-auto z-50">
                  <button onClick={() => { onMoveToProject(undefined); closeMenus(); }} className="w-full text-left px-3 py-1.5 hover:bg-bg-input">
                    <span className="text-fg-subtle">— None</span>
                  </button>
                  {projects.length === 0 && (
                    <div className="px-3 py-1.5 text-[10px] text-fg-subtle">No projects yet</div>
                  )}
                  {projects.map((p) => (
                    <button key={p.id} onClick={() => { onMoveToProject(p.id); closeMenus(); }} className="w-full text-left px-3 py-1.5 hover:bg-bg-input truncate">
                      {p.icon} {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border my-1" />
            <MenuButton
              icon={<ExportIcon />}
              label="Export Markdown"
              onClick={() => { void handleExportMarkdown(); setMenuOpen(false); }}
            />
            <div className="border-t border-border my-1" />
            <MenuButton
              icon={<DeleteIcon />}
              label="Delete"
              danger
              onClick={() => { onDelete(); setMenuOpen(false); }}
            />
          </div>
        </>
      )}

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={closeMenus} />
          <div
            className="fixed z-50 menu-panel py-1 min-w-48 text-xs"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <MenuButton
              icon={<RenameIcon />}
              label="Rename"
              onClick={() => { closeMenus(); handleRename(); }}
            />
            <MenuButton
              icon={<PinIcon />}
              label={conv.pinned ? 'Unpin session' : 'Pin session'}
              onClick={() => { onTogglePin(); closeMenus(); }}
            />
            <MenuButton
              icon={<ShareIcon />}
              label="Share"
              disabled
              onClick={() => closeMenus()}
            />
            <MenuButton
              icon={<ExportIcon />}
              label="Export Markdown"
              onClick={() => { void handleExportMarkdown(); closeMenus(); }}
            />
            <div className="border-t border-border my-1" />
            <MenuButton
              icon={<MoveIcon />}
              label="Move to folder"
              hasSubmenu
              onClick={() => setMoveOpen(!moveOpen)}
            />
            {moveOpen && (
              <div className="ml-6 border-l border-border pl-2 py-0.5">
                <button onClick={() => { onMoveToProject(undefined); closeMenus(); }} className="w-full text-left px-3 py-1.5 hover:bg-bg-input text-fg-muted">
                  — None
                </button>
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { onMoveToProject(p.id); closeMenus(); }} className="w-full text-left px-3 py-1.5 hover:bg-bg-input truncate text-fg-muted">
                    {p.icon} {p.name}
                  </button>
                ))}
              </div>
            )}
            <MenuButton
              icon={<SidePanelIcon />}
              label="Open in Side Panel"
              badge="beta"
              disabled
              onClick={() => closeMenus()}
            />
            <MenuButton
              icon={<MiniChatIcon />}
              label="Open in Mini Chat Window"
              disabled
              onClick={() => closeMenus()}
            />
            <div className="border-t border-border my-1" />
            <MenuButton
              icon={<ArchiveIcon />}
              label="Archive"
              onClick={() => { onArchive(); closeMenus(); }}
            />
            <MenuButton
              icon={<DeleteIcon />}
              label="Delete"
              danger
              onClick={() => { onDelete(); closeMenus(); }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger,
  disabled,
  hasSubmenu,
  badge
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hasSubmenu?: boolean;
  badge?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
        disabled
          ? 'text-fg-subtle/50 cursor-not-allowed'
          : danger
          ? 'text-danger hover:bg-bg-input'
          : 'text-fg hover:bg-bg-input'
      }`}
    >
      <span className="text-fg-subtle">{icon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {badge && <span className="px-1 py-0.5 rounded text-[9px] bg-bg border border-border text-fg-subtle">{badge}</span>}
      {hasSubmenu && <span className="text-fg-subtle">›</span>}
    </button>
  );
}

function conversationToMarkdown(title: string, messages: Message[]): string {
  const lines: string[] = [`# ${title || 'Untitled'}`, ''];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role === 'tool' ? `Tool (${m.name || 'tool'})` : m.role;
    const text = typeof m.content === 'string' ? m.content : m.content.map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image_url') return `[Image](${part.image_url.url})`;
      if (part.type === 'input_audio') return '[Audio]';
      if (part.type === 'file') return `[File: ${part.file.filename}]`;
      return '';
    }).join('\n');
    if (!text.trim()) continue;
    lines.push(`## ${role}`);
    lines.push(text);
    lines.push('');
  }
  return lines.join('\n');
}

function ChatIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6.5a4.5 4.5 0 10-9 0v4l-2 2h11l-2-2v-4z" />
    </svg>
  );
}

function PinIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5l1.5 3.5L11 5l-2.5 2.5L9 11 7 9l-2 2 .5-3.5L2.5 5l2.5-.5L6 1.5z" />
    </svg>
  );
}

function RenameIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8.5 2L10 3.5l-6 6H2.5v-1.5z" strokeLinejoin="round" />
    </svg>
  );
}

function ArchiveIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.5" y="3" width="9" height="2.5" rx="0.5" />
      <path d="M3 5.5v5h6v-5M5 7.5h2" />
    </svg>
  );
}

function MoveIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 3h6l1.5 1.5V10H2z" strokeLinejoin="round" />
    </svg>
  );
}

function ExportIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.5v7M3.5 4.5L6 1.5l2.5 3" />
      <path d="M2 9.5h8" />
    </svg>
  );
}

function ShareIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="3" r="1.5" />
      <circle cx="3" cy="6" r="1.5" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M4 5.5l4-2M4 6.5l4 2" />
    </svg>
  );
}

function SidePanelIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="10" height="8" rx="1" />
      <path d="M4 2v8" />
    </svg>
  );
}

function MiniChatIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="10" height="7" rx="1" />
      <path d="M3 1h6M3 1v2M9 1v2" />
    </svg>
  );
}

function DeleteIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3" />
    </svg>
  );
}

function ProjectsSection({
  projects,
  expanded,
  toggleProject,
  addingProject,
  setAddingProject,
  newProjectName,
  setNewProjectName,
  newProjectPath,
  setNewProjectPath,
  handleBrowseProject,
  handleSaveProject,
  handleCancelProject,
  conversations,
  onNewChatInProject,
  onSelectConversation,
  onDeleteConversation,
  onTogglePin,
  onRename,
  onArchive,
  onMoveToProject,
  currentId,
  isOpen
}: {
  projects: Project[];
  expanded: Set<string>;
  toggleProject: (id: string) => void;
  addingProject: boolean;
  setAddingProject: (v: boolean) => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  newProjectPath: string;
  setNewProjectPath: (v: string) => void;
  handleBrowseProject: () => Promise<void>;
  handleSaveProject: () => Promise<void>;
  handleCancelProject: () => void;
  conversations: Conversation[];
  onNewChatInProject: (projectId?: string) => Promise<void>;
  onSelectConversation: (id: string) => Promise<void> | void;
  onDeleteConversation: (id: string) => Promise<void> | void;
  onTogglePin: (id: string, pinned: boolean) => Promise<void> | void;
  onRename: (id: string, title: string) => Promise<void> | void;
  onArchive: (id: string) => Promise<void> | void;
  onMoveToProject: (id: string, projectId?: string) => Promise<void> | void;
  currentId?: string;
  isOpen: boolean;
}): JSX.Element {
  if (!isOpen) return <></>;
  return (
    <div>
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center justify-between">
        <span>Projects</span>
        <button
          onClick={() => setAddingProject(!addingProject)}
          className="text-fg-subtle hover:text-accent p-0.5 rounded"
          title="Add project"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M5 1v8M1 5h8" />
          </svg>
        </button>
      </div>
      {addingProject && (
        <div className="mx-2 mb-2 p-2 bg-bg-elev border border-border rounded-md space-y-1.5">
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
            className="w-full px-2 py-1 bg-bg-input border border-border rounded text-xs focus:outline-none focus:border-accent/50"
          />
          <div className="flex items-center gap-1">
            <input
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              placeholder="Folder path"
              className="flex-1 px-2 py-1 bg-bg-input border border-border rounded text-xs font-mono focus:outline-none focus:border-accent/50"
            />
            <button onClick={() => void handleBrowseProject()} className="px-1.5 py-1 text-xs bg-bg-input border border-border rounded hover:bg-bg">
              …
            </button>
          </div>
          <div className="flex items-center gap-1 justify-end">
            <button onClick={handleCancelProject} className="px-2 py-1 text-[10px] text-fg-subtle hover:text-fg">Cancel</button>
            <button
              onClick={() => void handleSaveProject()}
              disabled={!newProjectName.trim() || !newProjectPath.trim()}
              className="px-2 py-1 text-[10px] bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}
      <div className="space-y-0.5">
        {projects.map((p) => {
          const isOpen = expanded.has(p.id);
          const projectConvs = conversations.filter((c) => c.projectId === p.id);
          return (
            <div key={p.id}>
              <button
                onClick={() => toggleProject(p.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-bg-elev rounded-md transition"
              >
                <span className="text-fg-subtle text-[10px]">{isOpen ? '▾' : '▸'}</span>
                <span className="text-fg-subtle">{p.icon || '📁'}</span>
                <span className="flex-1 text-left text-fg-muted truncate">{p.name}</span>
                <span className="text-fg-subtle text-[10px]">{projectConvs.length}</span>
              </button>
              {isOpen && (
                <div className="ml-3 pl-2 border-l border-border space-y-0.5">
                  <button
                    onClick={() => void onNewChatInProject(p.id)}
                    className="w-full flex items-center gap-1 px-2 py-0.5 text-[10px] text-fg-subtle hover:text-fg hover:bg-bg-elev rounded"
                  >
                    <span>+ New chat</span>
                  </button>
                  {projectConvs.slice(0, 5).map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={c.id === currentId}
                      onSelect={() => onSelectConversation(c.id)}
                      onDelete={() => onDeleteConversation(c.id)}
                      onTogglePin={() => onTogglePin(c.id, !c.pinned)}
                      onRename={(t) => onRename(c.id, t)}
                      onArchive={() => onArchive(c.id)}
                      onMoveToProject={(pid) => onMoveToProject(c.id, pid)}
                      projects={projects}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArchivedSection({
  conversations,
  currentId,
  onSelect,
  onUnarchive,
  onDelete
}: {
  conversations: Conversation[];
  currentId?: string;
  onSelect: (id: string) => Promise<void> | void;
  onUnarchive: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle hover:text-fg flex items-center gap-1"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Archived ({conversations.length})</span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {conversations.map((c) => (
            <div key={c.id} className="relative group">
              <button
                onClick={() => onSelect(c.id)}
                className={`w-full text-left px-2 py-1.5 rounded-md transition text-xs ${c.id === currentId ? 'bg-bg-elev text-fg' : 'text-fg-subtle hover:bg-bg-elev hover:text-fg'}`}
              >
                <div className="truncate">{c.title || 'Untitled'}</div>
              </button>
              <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 flex gap-1">
                <button
                  onClick={() => onUnarchive(c.id)}
                  className="p-1 rounded text-fg-subtle hover:text-accent hover:bg-bg-elev"
                  title="Unarchive"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M2 7h8M2 7l2.5-2.5M2 7l2.5 2.5" />
                  </svg>
                </button>
                <button
                  onClick={() => onDelete(c.id)}
                  className="p-1 rounded text-fg-subtle hover:text-danger hover:bg-bg-elev"
                  title="Delete"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                    <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({ results, onSelect }: { results: Array<{ conversationId: string; snippet: string; role: string }>; onSelect: (id: string) => void }): JSX.Element {
  if (results.length === 0) {
    return <div className="px-3 py-4 text-center text-xs text-fg-subtle">No matches</div>;
  }
  return (
    <div>
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        Search results
      </div>
      <div className="space-y-0.5">
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => onSelect(r.conversationId)}
            className="w-full text-left px-2 py-1.5 hover:bg-bg-elev rounded-md"
          >
            <div className="text-[10px] text-fg-subtle uppercase mb-0.5">{r.role}</div>
            <div className="text-xs text-fg-muted line-clamp-2">{escapeHtml(r.snippet)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "Check for updates" — queries the GitHub repo for a newer release. When one
// exists, a single click downloads the platform installer and launches it
// (or opens the release page when the release has no installer asset).
function UpdateChecker(): JSX.Element {
  type UpdateInfo = Awaited<ReturnType<typeof window.hive.updateCheck>>;
  const [state, setState] = useState<'idle' | 'checking' | 'uptodate' | 'available' | 'noreleases' | 'error' | 'installing'>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  const check = async (): Promise<void> => {
    setState('checking');
    const r = await window.hive.updateCheck();
    setInfo(r);
    if (!r.ok) { setState('error'); revertSoon(); return; }
    if (r.updateAvailable) { setState('available'); return; }
    setState(r.noReleases ? 'noreleases' : 'uptodate');
    revertSoon();
  };

  const revertSoon = (): void => { setTimeout(() => setState((s) => (s === 'available' || s === 'installing' ? s : 'idle')), 4000); };

  const install = async (): Promise<void> => {
    if (!info?.url && !info?.assetUrl) return;
    setState('installing');
    const r = await window.hive.updateInstall({ assetUrl: info.assetUrl, assetName: info.assetName, url: info.url || '' });
    if (!r.ok) { setState('error'); revertSoon(); return; }
    // Installer launched (or release page opened) — leave the button available
    // in case the user cancels the installer.
    setState('available');
  };

  if (state === 'available' || state === 'installing') {
    return (
      <button
        onClick={() => void install()}
        disabled={state === 'installing'}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-accent text-white text-[11px] font-medium hover:opacity-90 transition disabled:opacity-60"
        title={info?.assetUrl ? 'Download and run the installer' : 'Open the release page'}
      >
        {state === 'installing' ? (
          'Downloading…'
        ) : (
          <>
            <UpdateIcon />
            Update to {info?.latest}
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => void check()}
      disabled={state === 'checking'}
      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-bg-elev text-fg-subtle hover:text-fg transition text-[11px] disabled:opacity-60"
      title="Check GitHub for a newer version"
    >
      <UpdateIcon spinning={state === 'checking'} />
      {state === 'checking' ? 'Checking…'
        : state === 'uptodate' ? `✓ Up to date (v${info?.current})`
        : state === 'noreleases' ? 'No releases yet'
        : state === 'error' ? 'Check failed'
        : 'Check for updates'}
    </button>
  );
}

function UpdateIcon({ spinning }: { spinning?: boolean }): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={spinning ? 'animate-spin' : ''}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" strokeLinejoin="round" />
    </svg>
  );
}
