import { useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { Skill } from '@shared/types';

export function SkillsPanel(): JSX.Element {
  const skills = useAppStore((s) => s.skills);
  const saveSkill = async (s: Skill): Promise<void> => { await window.hive.skillSave(s); void useAppStore.getState().loadSkills(); };
  const deleteSkill = async (id: string): Promise<void> => { await window.hive.skillDelete(id); void useAppStore.getState().loadSkills(); };
  const [editing, setEditing] = useState<Skill | null>(null);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Skills</h3>
          <p className="text-xs text-fg-muted mt-1">
            Reusable prompt templates invoked with slash commands. Drop Agent Skills folders (SKILL.md) into the skills folder and rescan.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => void window.hive.skillOpenDir()} className="btn-secondary">Open skills folder</button>
          <button onClick={() => { void window.hive.skillRescan().then(() => useAppStore.getState().loadSkills()); }} className="btn-secondary">Rescan</button>
          <button onClick={() => setEditing({
            id: `skill-${Date.now()}`, name: '', description: '',
            slashCommand: '/', prompt: '', enabled: true, category: 'custom'
          })} className="btn-primary">+ New skill</button>
        </div>
      </div>

      <div className="space-y-2">
        {skills.map((s) => (
          <div key={s.id} className="p-3 bg-bg border border-border rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-accent text-sm">{s.slashCommand}</span>
                  <span className="font-medium">{s.name}</span>
                  {s.builtin && <span className="text-[10px] uppercase text-fg-subtle">built-in</span>}
                  {s.category === 'user' && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-accent-soft text-accent">folder</span>}
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

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-xs font-medium text-fg-muted mb-1">{label}</div>
      {children}
    </div>
  );
}