import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { Project } from '@shared/types';

export function ProjectsPanel(): JSX.Element {
  const projects = useAppStore((s) => s.projects);
  const mcpStatuses = useAppStore((s) => s.mcpStatuses);
  const saveProject = useAppStore((s) => s.saveProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
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
      config: { kind: 'general', mcpServerIds: [] },
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
      await saveProject({ ...editing, name: editing.name.trim(), path: editing.path.trim() });
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

  const updateConfig = (patch: NonNullable<Project['config']>): void => {
    if (editing) setEditing({ ...editing, config: { ...editing.config, ...patch } });
  };

  const updateKnowledge = (patch: Partial<NonNullable<NonNullable<Project['config']>['knowledge']>>): void => {
    if (!editing) return;
    if (patch.serverId === '') { updateConfig({ knowledge: undefined }); return; }
    const current = editing.config?.knowledge || { provider: 'obsidian' as const, serverId: '', folder: '' };
    updateConfig({ knowledge: { ...current, ...patch } });
  };

  const toggleMcpServer = (id: string): void => {
    const selected = editing?.config?.mcpServerIds || [];
    updateConfig({ mcpServerIds: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] });
  };

  const obsidianServers = mcpStatuses.filter((server) => {
    const tools = server.tools.map((tool) => tool.name.toLowerCase());
    return server.id === editing?.config?.knowledge?.serverId
      || (tools.some((name) => name.endsWith('vault_read')) && tools.some((name) => name.endsWith('search_simple')))
      || /obsidian|vault/i.test(`${server.id} ${server.name}`);
  });

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
          <fieldset>
            <legend className="text-sm text-fg-subtle">Project kind</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([
                { value: 'general', label: 'General', detail: 'Standard project workspace' },
                { value: 'dero', label: 'DERO', detail: 'Chain research and simulator tools' }
              ] as const).map((option) => (
                <label key={option.value} className={`cursor-pointer rounded-lg border p-2.5 ${
                  (editing.config?.kind || 'general') === option.value ? 'border-accent/60 bg-accent-soft' : 'border-border bg-bg'
                }`}>
                  <input
                    type="radio"
                    name="project-kind"
                    value={option.value}
                    checked={(editing.config?.kind || 'general') === option.value}
                    onChange={() => updateConfig({ kind: option.value })}
                    className="mr-2 accent-accent"
                  />
                  <span className="text-sm font-medium text-fg">{option.label}</span>
                  <span className="mt-0.5 block pl-5 text-[10px] text-fg-subtle">{option.detail}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-3 rounded-lg border border-border bg-bg p-3">
            <legend className="px-1 text-sm font-medium text-fg">Obsidian knowledge</legend>
            <div>
              <label htmlFor="project-obsidian-server" className="text-xs text-fg-subtle">Obsidian MCP server</label>
              <select
                id="project-obsidian-server"
                value={editing.config?.knowledge?.serverId || ''}
                onChange={(event) => updateKnowledge({ serverId: event.target.value })}
                className="input mt-1 w-full"
              >
                <option value="">Not linked</option>
                {obsidianServers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name} · {server.connected ? 'connected' : 'offline'}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="project-vault-folder" className="text-xs text-fg-subtle">Vault folder</label>
              <input
                id="project-vault-folder"
                value={editing.config?.knowledge?.folder || ''}
                onChange={(event) => updateKnowledge({ folder: event.target.value })}
                disabled={!editing.config?.knowledge?.serverId}
                className="input mt-1 w-full font-mono text-xs"
                placeholder="projects/my-project"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={editing.config?.knowledge?.allowAutomationWrites === true}
                onChange={(event) => updateKnowledge({ allowAutomationWrites: event.target.checked })}
                disabled={!editing.config?.knowledge?.serverId}
                className="mt-0.5 accent-accent"
              />
              <span>Allow automation writes after the normal approval step.</span>
            </label>
          </fieldset>
          <fieldset className="rounded-lg border border-border bg-bg p-3">
            <legend className="px-1 text-sm font-medium text-fg">Project MCP servers</legend>
            {mcpStatuses.length === 0 ? (
              <p className="text-xs text-fg-subtle">Add an MCP server before assigning project integrations.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {mcpStatuses.map((server) => (
                  <label key={server.id} className="flex items-center gap-2 rounded-md border border-border bg-bg-input px-2.5 py-2 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={(editing.config?.mcpServerIds || []).includes(server.id)}
                      onChange={() => toggleMcpServer(server.id)}
                      className="accent-accent"
                    />
                    <span className={`h-1.5 w-1.5 rounded-full ${server.connected ? 'bg-success' : server.error ? 'bg-danger' : 'bg-fg-subtle'}`} />
                    <span className="truncate">{server.name}</span>
                  </label>
                ))}
              </div>
            )}
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
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.config?.kind === 'dero' && <span className="rounded border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] text-accent">DERO</span>}
              </div>
              <div className="text-xs text-fg-subtle truncate font-mono">{p.path}</div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={() => handleEdit(p)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev">Edit</button>
              <button onClick={() => void handleDelete(p.id)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev text-danger">Delete</button>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .input {
          background: var(--bg-input);
          border: 1px solid var(--border);
          color: var(--fg);
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 13px;
        }
        .input:focus { outline: none; border-color: var(--accent); }
        .btn-primary {
          background: var(--accent);
          color: white;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 13px;
        }
        .btn-primary:hover { opacity: 0.9; }
        .btn-secondary {
          background: var(--bg-input);
          border: 1px solid var(--border);
          color: var(--fg);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 13px;
        }
        .btn-secondary:hover { background: var(--bg-elev); }
      `}</style>
    </div>
  );
}
