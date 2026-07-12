import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { Skill, SkillImportPreview } from '@shared/types';

export function SkillsPanel(): JSX.Element {
  const skills = useAppStore((s) => s.skills);
  const saveSkill = async (s: Skill): Promise<void> => { await window.hive.skillSave(s); void useAppStore.getState().loadSkills(); };
  const deleteSkill = async (id: string): Promise<void> => { await window.hive.skillDelete(id); void useAppStore.getState().loadSkills(); };
  const [editing, setEditing] = useState<Skill | null>(null);
  const [importPreview, setImportPreview] = useState<SkillImportPreview | null>(null);
  const [importError, setImportError] = useState('');

  const pickSkillFolder = async (): Promise<void> => {
    setImportError('');
    const result = await window.hive.skillImportPick();
    if (!result.ok) {
      if (!result.cancelled) setImportError(result.error || 'Could not read that folder.');
      return;
    }
    setImportPreview(result.preview);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Skills</h3>
          <p className="text-xs text-fg-muted mt-1">Reusable prompt templates invoked with slash commands.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void window.hive.skillOpenDir()} className="btn-secondary">Open skills folder</button>
          <button onClick={() => void window.hive.skillRescan().then(() => useAppStore.getState().loadSkills())} className="btn-secondary">Rescan</button>
          <button onClick={() => void pickSkillFolder()} className="btn-secondary">Import folder…</button>
          <button onClick={() => setEditing({
            id: `skill-${Date.now()}`, name: '', description: '',
            slashCommand: '/', prompt: '', enabled: true, category: 'custom'
          })} className="btn-primary">+ New skill</button>
        </div>
      </div>

      {importError && <div className="text-xs text-danger bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">{importError}</div>}

      <div className="space-y-2">
        {skills.map((s) => (
          <div key={s.id} className="p-3 bg-bg border border-border rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-accent text-sm">{s.slashCommand}</span>
                  <span className="font-medium">{s.name}</span>
                  {s.builtin && <span className="text-[10px] uppercase text-fg-subtle">built-in</span>}
                  {s.sourceDir && <span className="text-[10px] uppercase text-fg-subtle">file-synced</span>}
                  {!s.enabled && <span className="text-[10px] uppercase text-danger">disabled</span>}
                </div>
                <div className="text-xs text-fg-muted mt-0.5">{s.description}</div>
                <pre className="text-[10px] text-fg-subtle mt-1 line-clamp-2 whitespace-pre-wrap">{s.prompt.slice(0, 200)}</pre>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-fg-muted">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => void saveSkill({ ...s, enabled: e.target.checked })} className="accent-accent" />
                </label>
                <button onClick={() => setEditing(s)} className="btn-secondary">Edit</button>
                <button onClick={() => { if (confirm(`Delete ${s.name}?`)) void deleteSkill(s.id); }} className="btn-secondary text-danger">×</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} onSave={async (s) => { await saveSkill(s); setEditing(null); }} />}

      {importPreview && (
        <SkillImportDialog
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onImport={async () => {
            const result = await window.hive.skillImport(importPreview.sourceDir);
            if (!result.ok) { setImportError(result.error); setImportPreview(null); return; }
            setImportPreview(null);
            void useAppStore.getState().loadSkills();
          }}
        />
      )}

      <style>{`
        .btn-primary { background: #d97757; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; }
        .btn-secondary { background: #333230; border: 1px solid #3a3936; color: #faf9f5; padding: 5px 10px; border-radius: 6px; font-size: 11px; }
        .btn-secondary:hover { background: var(--bg-elev); }
        .input { background: var(--bg-input); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 6px; font-size: 13px; }
        .input:focus { outline: none; border-color: var(--accent); }
      `}</style>
    </div>
  );
}

function SkillEditor({ skill, onClose, onSave }: { skill: Skill; onClose: () => void; onSave: (s: Skill) => Promise<void> }): JSX.Element {
  const [s, setS] = useState<Skill>(skill);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-bg-elev border border-border rounded-xl shadow-2xl max-w-2xl w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">{skill.builtin ? 'Edit built-in skill' : 'Edit skill'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="input w-full" /></Field>
          <Field label="Slash command"><input value={s.slashCommand} onChange={(e) => setS({ ...s, slashCommand: e.target.value })} className="input w-full font-mono" /></Field>
        </div>
        <Field label="Description"><input value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} className="input w-full" /></Field>
        <Field label="Category"><input value={s.category || ''} onChange={(e) => setS({ ...s, category: e.target.value })} className="input w-full" /></Field>
        <Field label="Prompt"><textarea value={s.prompt} onChange={(e) => setS({ ...s, prompt: e.target.value })} rows={10} className="input w-full font-mono text-xs" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => void onSave(s)} className="btn-primary">Save</button>
        </div>
      </div>
      <style>{`
        .input { background: #1f1e1c; border: 1px solid #3a3936; color: #faf9f5; padding: 6px 10px; border-radius: 6px; font-size: 13px; }
        .input:focus { outline: none; border-color: #d97757; }
        .btn-secondary { background: #333230; border: 1px solid #3a3936; color: #faf9f5; padding: 5px 12px; border-radius: 6px; font-size: 12px; }
        .btn-primary { background: #d97757; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; }
      `}</style>
    </div>
  );
}

function SkillImportDialog({ preview, onClose, onImport }: { preview: SkillImportPreview; onClose: () => void; onImport: () => Promise<void> }): JSX.Element {
  const [importing, setImporting] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-bg-elev border border-border rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Import skill</h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-accent text-sm">{preview.slashCommand}</span>
          <span className="font-medium">{preview.name}</span>
        </div>
        <p className="text-xs text-fg-muted">{preview.description}</p>
        {preview.warnings.length > 0 && (
          <div className="space-y-1">
            {preview.warnings.map((w) => (
              <div key={w} className="text-[11px] text-warn bg-warn/10 border border-warn/25 rounded-md px-2 py-1">⚠ {w}</div>
            ))}
          </div>
        )}
        <pre className="text-[10px] text-fg-subtle bg-bg border border-border rounded-lg p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">{preview.prompt.slice(0, 1000)}</pre>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            disabled={importing}
            onClick={() => { setImporting(true); void onImport(); }}
            className="btn-primary disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-xs font-medium text-fg-muted mb-1">{label}</div>
      {children}
    </div>
  );
}