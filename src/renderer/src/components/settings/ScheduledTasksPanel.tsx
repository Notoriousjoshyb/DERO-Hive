import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app';

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: string; // cron-like: 'daily', 'weekly', 'hourly', or interval in minutes
  providerId: string;
  model: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  projectId?: string;
}

const SCHEDULE_PRESETS = [
  { label: 'Every hour', value: '60' },
  { label: 'Every 6 hours', value: '360' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekly (Mon)', value: 'weekly-mon' },
  { label: 'Custom (minutes)', value: 'custom' },
];

export function ScheduledTasksPanel(): JSX.Element {
  const providers = useAppStore((s) => s.providers);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Partial<ScheduledTask> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load from localStorage (simple persistence for now)
  const loadTasks = useCallback(() => {
    try {
      const raw = localStorage.getItem('hive-scheduled-tasks');
      setTasks(raw ? JSON.parse(raw) : []);
    } catch { setTasks([]); }
    setLoading(false);
  }, []);

  const saveTasks = useCallback((updated: ScheduledTask[]) => {
    setTasks(updated);
    localStorage.setItem('hive-scheduled-tasks', JSON.stringify(updated));
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const handleAdd = (): void => {
    setEditing({
      id: crypto.randomUUID(),
      name: '',
      prompt: '',
      schedule: 'daily',
      providerId: providers[0]?.id || '',
      model: providers[0]?.models[0]?.id || '',
      enabled: true,
    });
    setShowForm(true);
    setError(null);
  };

  const handleEdit = (task: ScheduledTask): void => {
    setEditing({ ...task });
    setShowForm(true);
    setError(null);
  };

  const handleSave = (): void => {
    if (!editing || !editing.name?.trim() || !editing.prompt?.trim()) {
      setError('Name and prompt are required.');
      return;
    }
    const existing = tasks.findIndex((t) => t.id === editing.id);
    const task: ScheduledTask = {
      id: editing.id!,
      name: editing.name.trim(),
      prompt: editing.prompt.trim(),
      schedule: editing.schedule || 'daily',
      providerId: editing.providerId || providers[0]?.id || '',
      model: editing.model || providers[0]?.models[0]?.id || '',
      enabled: editing.enabled ?? true,
      lastRunAt: editing.lastRunAt,
      nextRunAt: editing.nextRunAt,
      projectId: editing.projectId,
    };
    if (existing >= 0) {
      const updated = [...tasks];
      updated[existing] = task;
      saveTasks(updated);
    } else {
      saveTasks([...tasks, task]);
    }
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = (id: string): void => {
    saveTasks(tasks.filter((t) => t.id !== id));
  };

  const handleToggle = (id: string): void => {
    saveTasks(tasks.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const handleRunNow = async (task: ScheduledTask): Promise<void> => {
    try {
      const conv = await window.hive.convCreate({ title: `Scheduled: ${task.name}`, projectId: task.projectId });
      await window.hive.chatSend({
        conversationId: conv.id,
        providerId: task.providerId,
        model: task.model,
        messages: [{ id: crypto.randomUUID(), role: 'user', content: task.prompt, createdAt: Date.now() }],
      });
      const updated = tasks.map((t) => t.id === task.id ? { ...t, lastRunAt: Date.now() } : t);
      saveTasks(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run task');
    }
  };

  const formatDate = (ts?: number): string => ts ? new Date(ts).toLocaleString() : 'Never';
  const formatSchedule = (s: string): string => {
    const p = SCHEDULE_PRESETS.find((x) => x.value === s);
    if (p) return p.label;
    const n = parseInt(s, 10);
    return n ? `Every ${n} minutes` : s;
  };

  return (
    <div className="p-4 max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Scheduled Tasks</h2>
          <p className="text-sm text-fg-subtle mt-1">Recurring prompts that run automatically</p>
        </div>
        <button onClick={handleAdd} className="bg-accent text-white px-3 py-1.5 rounded-lg text-sm hover:bg-accent-hover">Add Task</button>
      </div>

      {error && <div className="p-2 bg-danger/10 text-danger text-sm rounded">{error}</div>}

      {loading && <div className="text-fg-subtle py-8 text-center">Loading...</div>}

      {!loading && tasks.length === 0 && !showForm && (
        <div className="text-center py-12 text-fg-subtle">
          <p className="text-4xl mb-3">⏰</p>
          <p>No scheduled tasks yet</p>
          <p className="text-sm mt-1">Create a recurring prompt to get automatic responses</p>
        </div>
      )}

      {showForm && editing && (
        <div className="bg-bg-input border border-border rounded-xl p-4 space-y-3">
          <h3 className="font-medium">{tasks.find((t) => t.id === editing.id) ? 'Edit Task' : 'New Task'}</h3>
          <div>
            <label className="text-sm text-fg-subtle">Name</label>
            <input type="text" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="input w-full mt-1" placeholder="Daily standup update" />
          </div>
          <div>
            <label className="text-sm text-fg-subtle">Prompt</label>
            <textarea value={editing.prompt || ''} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
              rows={4} className="input w-full mt-1 resize-y text-sm" placeholder="Write a prompt that will be sent to the model on schedule..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-fg-subtle">Schedule</label>
              <select value={editing.schedule || 'daily'} onChange={(e) => setEditing({ ...editing, schedule: e.target.value })}
                className="input w-full mt-1">
                {SCHEDULE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-fg-subtle">Enabled</label>
              <div className="mt-2">
                <input type="checkbox" checked={editing.enabled !== false} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                  className="accent-accent w-4 h-4" />
                <span className="ml-2 text-sm text-fg-muted">Active</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-fg-subtle">Provider</label>
              <select value={editing.providerId || ''} onChange={(e) => setEditing({ ...editing, providerId: e.target.value })}
                className="input w-full mt-1">
                {providers.filter((p) => p.enabled).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-fg-subtle">Model</label>
              <select value={editing.model || ''} onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                className="input w-full mt-1">
                {providers.find((p) => p.id === editing.providerId)?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>) || <option value="">Select provider first</option>}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setShowForm(false); setEditing(null); setError(null); }}
              className="px-3 py-1.5 rounded-lg border border-border text-sm text-fg-muted hover:bg-bg-input">Cancel</button>
            <button onClick={handleSave} className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover">Save</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 p-3 bg-bg-input rounded-lg border border-border group">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${task.enabled ? 'bg-success' : 'bg-fg-subtle/40'}`} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm flex items-center gap-2">
                {task.name}
                <span className="text-[10px] text-fg-muted font-normal">{formatSchedule(task.schedule)}</span>
              </div>
              <div className="text-xs text-fg-subtle truncate mt-0.5">{task.prompt.slice(0, 80)}</div>
              <div className="text-[10px] text-fg-muted mt-0.5">Last run: {formatDate(task.lastRunAt)}</div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={() => void handleRunNow(task)} disabled={!task.enabled}
                className="px-2 py-1 text-xs rounded hover:bg-bg-elev disabled:opacity-40" title="Run now">▶</button>
              <button onClick={() => handleEdit(task)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev" title="Edit">✎</button>
              <button onClick={() => handleToggle(task.id)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev" title={task.enabled ? 'Pause' : 'Resume'}>
                {task.enabled ? '⏸' : '▶'}
              </button>
              <button onClick={() => handleDelete(task.id)} className="px-2 py-1 text-xs rounded hover:bg-bg-elev text-danger" title="Delete">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
