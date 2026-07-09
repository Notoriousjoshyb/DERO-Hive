import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { Project } from '@shared/types';

export function ProjectsPanel(): JSX.Element {
  const projects = useAppStore((s) => s.projects);
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
