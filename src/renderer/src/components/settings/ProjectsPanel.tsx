import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { Project } from '@shared/types';

export function ProjectsPanel(): JSX.Element {
  const projects = useAppStore((s) => s.projects);
  const saveProject = useAppStore((s) => s.saveProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const mcpStatuses = useAppStore((s) => s.mcpStatuses);
  const openProjectCockpit = useAppStore((s) => s.openProjectCockpit);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [editing, setEditing] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleAdd = (): void => {
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      icon: '📁',
      path: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    setFormError(null);
    setShowForm(true);
  };

  const handleEdit = (p: Project): void => {
    setEditing({ ...p });
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.name.trim()) { setFormError('Project name is required.'); return; }
    if (!editing.path.trim()) { setFormError('Folder path is required.'); return; }
    setSaving(true);
    setFormError(null);
    try {
      // DERO project type and MCP context do not require an Obsidian vault.
      // Do not send a partially filled vault object to the strict main-process
      // validator; a vault is only configured once both fields are present.
      const draftConfig = { ...editing.config };
      const draftKnowledge = draftConfig.knowledge;
      if (!draftKnowledge?.serverId?.trim() || !draftKnowledge.folder?.trim()) delete draftConfig.knowledge;
      await saveProject({ ...editing, name: editing.name.trim(), path: editing.path.trim(), config: draftConfig });
      setShowForm(false);
      setEditing(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm('Delete this project? Conversations will not be deleted.')) return;
    await deleteProject(id);
  };

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.hive.fsPickDirectory();
    if (dir && editing) setEditing({ ...editing, path: dir });
  };

  const updateKnowledge = (patch: Partial<NonNullable<NonNullable<Project['config']>['knowledge']>>): void => {
    if (!editing) return;
    const updateConfig = (knowledge: NonNullable<Project['config']>['knowledge']): void =>
      setEditing({ ...editing, config: { ...editing.config, knowledge } });
    if (patch.serverId === '') { updateConfig(undefined); return; }
    const current = editing.config?.knowledge || { provider: 'obsidian' as const, serverId: '', folder: '' };
    updateConfig({ ...current, ...patch });
  };

  const toggleProjectMcp = (serverId: string): void => {
    if (!editing) return;
    const ids = editing.config?.mcpServerIds || [];
    const mcpServerIds = ids.includes(serverId) ? ids.filter((id) => id !== serverId) : [...ids, serverId];
    setEditing({ ...editing, config: { ...editing.config, mcpServerIds } });
  };

  const openCockpit = (id: string): void => {
    setSettingsOpen(false);
    openProjectCockpit(id);
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="text-sm text-fg-subtle mt-1">Link folders to organize your conversations</p>
        </div>
        <button onClick={handleAdd} className="btn-primary">Add Project</button>
      </div>

      {projects.length === 0 && !showForm && (
        <div className="text-center py-12 text-fg-subtle">
          <div className="text-4xl mb-3">📁</div>
          <p>No projects yet</p>
          <p className="text-sm mt-1">Add a folder to organize your conversations</p>
        </div>
      )}

      {showForm && editing && (
        <div className="bg-bg-input border border-border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">{editing.createdAt === editing.updatedAt ? 'New Project' : 'Edit Project'}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-fg-subtle">Icon</label>
              <input
                type="text"
                value={editing.icon}
                onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                className="input w-full mt-1"
                placeholder="📁"
              />
            </div>
            <div>
              <label className="text-sm text-fg-subtle">Name</label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="input w-full mt-1"
                placeholder="My Project"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-fg-subtle">Folder Path</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={editing.path}
                onChange={(e) => setEditing({ ...editing, path: e.target.value })}
                className="input flex-1 font-mono text-xs"
                placeholder="C:\path\to\project"
              />
              <button onClick={handleBrowse} className="btn-secondary">Browse…</button>
            </div>
          </div>

          <div>
            <label className="text-sm text-fg-subtle">Project type</label>
            <select
              value={editing.config?.kind || 'general'}
              onChange={(e) => setEditing({ ...editing, config: { ...editing.config, kind: e.target.value as 'general' | 'dero' } })}
              className="input w-full mt-1"
            >
              <option value="general">General</option>
              <option value="dero">DERO developer project</option>
            </select>
            <p className="mt-1 text-[11px] text-fg-subtle">DERO projects show the Contract Studio, simulator controls, and development prompts in their cockpit.</p>
          </div>

          <div>
            <label className="text-sm text-fg-subtle">Trust level</label>
            <select
              value={editing.config?.trust || 'standard'}
              onChange={(e) => setEditing({ ...editing, config: { ...editing.config, trust: e.target.value as 'untrusted' | 'standard' | 'trusted' } })}
              className="input w-full mt-1"
            >
              <option value="untrusted">Untrusted</option>
              <option value="standard">Standard</option>
              <option value="trusted">Trusted</option>
            </select>
            <p className="mt-1 text-[11px] text-fg-subtle">
              {(editing.config?.trust || 'standard') === 'untrusted'
                ? 'Every tool call asks — autopilot and allow rules are disabled; deny rules still apply.'
                : (editing.config?.trust || 'standard') === 'trusted'
                ? 'Trusted — autopilot may be offered for this project.'
                : 'Standard — your global approval mode applies.'}
            </p>
          </div>

          {editing.config?.kind === 'dero' && (
            <fieldset className="rounded-lg border border-border p-3 space-y-2">
              <legend className="px-1 text-sm font-medium text-fg">DERO MCP context</legend>
              <p className="text-[11px] text-fg-subtle">Record the MCP servers this project expects for read-only DERO documentation and chain context. Connection and tool permissions remain under your control.</p>
              {mcpStatuses.length === 0 ? <p className="text-xs text-fg-subtle">No MCP servers configured.</p> : mcpStatuses.map((server) => (
                <label key={server.id} className="flex items-center gap-2 text-sm text-fg-muted">
                  <input type="checkbox" checked={(editing.config?.mcpServerIds || []).includes(server.id)} onChange={() => toggleProjectMcp(server.id)} className="accent-accent" />
                  <span>{server.name}</span><span className={`text-[10px] ${server.connected ? 'text-success' : 'text-fg-subtle'}`}>{server.connected ? 'connected' : 'offline'}</span>
                </label>
              ))}
            </fieldset>
          )}

          <fieldset className="rounded-lg border border-border p-3 space-y-3">
            <legend className="px-1 text-sm font-medium text-fg">Obsidian knowledge</legend>
            <div>
              <label className="text-sm text-fg-subtle">Vault MCP server</label>
              <select
                value={editing.config?.knowledge?.serverId || ''}
                onChange={(e) => updateKnowledge({ serverId: e.target.value })}
                className="input w-full mt-1"
              >
                <option value="">Not linked</option>
                {mcpStatuses.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}{server.connected ? '' : ' (offline)'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-fg-subtle">Vault folder (relative to the vault root)</label>
              <input
                type="text"
                value={editing.config?.knowledge?.folder || ''}
                onChange={(e) => updateKnowledge({ folder: e.target.value })}
                disabled={!editing.config?.knowledge?.serverId}
                className="input w-full mt-1 font-mono text-xs disabled:opacity-50"
                placeholder="Projects/My Project"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-fg-subtle">
              <input
                type="checkbox"
                checked={editing.config?.knowledge?.allowAutomationWrites === true}
                onChange={(e) => updateKnowledge({ allowAutomationWrites: e.target.checked })}
                disabled={!editing.config?.knowledge?.serverId}
                className="accent-accent"
              />
              Allow automatic writes (captures, daily digest, weekly synthesis)
            </label>
          </fieldset>

          {formError && (
            <div className="text-sm text-danger">{formError}</div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setEditing(null); setFormError(null); }} className="btn-secondary">Cancel</button>
            <button onClick={() => void handleSave()} disabled={saving} className="btn-primary disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {projects.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 bg-bg-input rounded-lg group">
            <span className="text-2xl">{p.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-fg-subtle truncate font-mono">{p.path}</div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={() => openCockpit(p.id)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev">Cockpit</button>
              <button onClick={() => handleEdit(p)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev">Edit</button>
              <button onClick={() => void handleDelete(p.id)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev text-danger">Delete</button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
