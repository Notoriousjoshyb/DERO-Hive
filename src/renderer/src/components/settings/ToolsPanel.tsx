import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app';
import type { PermissionRule } from '@shared/types';

type RuleAction = PermissionRule['action'];

const ACTION_BADGE: Record<RuleAction, string> = {
  allow: 'bg-success/20 text-success',
  ask: 'bg-warn/20 text-warn',
  deny: 'bg-danger/20 text-danger'
};

/**
 * Permission rules manager (Phase 1F) plus the read-only registered-tools
 * list this panel used to be. Rules are evaluated in main: tool name matches
 * exactly or via '*', the pattern is a substring (or /regex/) tested against
 * JSON-stringified args, deny is absolute, ask beats allow, and untrusted
 * projects downgrade allows to asks.
 */
export function ToolsPanel(): JSX.Element {
  const tools = useAppStore((s) => s.tools);
  const projects = useAppStore((s) => s.projects);

  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const [toolName, setToolName] = useState('');
  const [action, setAction] = useState<RuleAction>('ask');
  const [pattern, setPattern] = useState('');
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [projectId, setProjectId] = useState('');

  const loadRules = useCallback(async (): Promise<void> => {
    try {
      setRules(await window.hive.permissionRuleList());
      setListError(null);
    } catch (err) {
      setListError(ipcErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleAdd = async (): Promise<void> => {
    const trimmedTool = toolName.trim();
    const trimmedPattern = pattern.trim();
    // Mirror the main-process validator so obvious mistakes fail locally.
    if (!trimmedTool) { setFormError('Tool name is required — use * to match every tool.'); return; }
    if (trimmedPattern.startsWith('/') && trimmedPattern.endsWith('/') && trimmedPattern.length > 1) {
      try {
        new RegExp(trimmedPattern.slice(1, -1));
      } catch {
        setFormError('Pattern is not a valid regular expression.');
        return;
      }
    }
    let projectPath: string | undefined;
    if (scope === 'project') {
      const project = projects.find((p) => p.id === projectId);
      if (!project) { setFormError('Project-scoped rules require a project.'); return; }
      projectPath = project.path;
    }
    setSaving(true);
    setFormError(null);
    try {
      await window.hive.permissionRuleAdd({
        toolName: trimmedTool,
        action,
        pattern: trimmedPattern || undefined,
        scope,
        projectPath
      });
      setToolName('');
      setPattern('');
      setAction('ask');
      setScope('global');
      setProjectId('');
      await loadRules();
    } catch (err) {
      setFormError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (rule: PermissionRule): Promise<void> => {
    if (rule.action === 'deny' && !confirm(`Delete the deny rule for "${rule.toolName}"? Matching tools will no longer be blocked outright.`)) return;
    try {
      await window.hive.permissionRuleRemove(rule.id);
      await loadRules();
    } catch (err) {
      setListError(ipcErrorMessage(err));
    }
  };

  const scopeLabel = (rule: PermissionRule): string => {
    if (rule.scope !== 'project') return 'global';
    return projects.find((p) => p.path === rule.projectPath)?.name || rule.projectPath || 'project';
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle mb-2">Permission rules</h3>
        <p className="text-xs text-fg-muted mb-3">
          Rules match a tool by exact name or <span className="font-mono">*</span>; the optional pattern is a substring
          (or <span className="font-mono">/regex/</span>) tested against the call's JSON arguments. Deny is absolute,
          ask beats allow, and untrusted projects downgrade allow to ask.
        </p>

        {loading ? (
          <div className="text-xs text-fg-subtle">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="text-xs text-fg-subtle mb-3">No rules yet — your global approval mode decides every tool call.</div>
        ) : (
          <div className="space-y-1.5 mb-3">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 px-3 py-2 bg-bg-input border border-border rounded-lg">
                <span className="font-mono text-xs text-fg truncate max-w-40" title={rule.toolName}>{rule.toolName}</span>
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${ACTION_BADGE[rule.action]}`}>{rule.action}</span>
                <span className={`flex-1 min-w-0 font-mono text-[11px] truncate ${rule.pattern ? 'text-fg-muted' : 'text-fg-subtle/60'}`} title={rule.pattern}>{rule.pattern || 'any args'}</span>
                <span className="text-[10px] text-fg-subtle flex-shrink-0 max-w-28 truncate" title={rule.scope === 'project' ? rule.projectPath : undefined}>{scopeLabel(rule)}</span>
                <button
                  onClick={() => void handleRemove(rule)}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-fg-subtle hover:text-danger hover:bg-bg-elev rounded transition"
                  title="Delete rule"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {listError && <div className="text-xs text-danger mb-3">{listError}</div>}

        <div className="bg-bg-input border border-border rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-medium">Add rule</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-fg-subtle">Tool name</label>
              <input
                type="text"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                className="input w-full mt-1 font-mono text-xs"
                placeholder="bash, write_file, mcp:server.tool, or *"
              />
            </div>
            <div>
              <label className="text-sm text-fg-subtle">Action</label>
              <select value={action} onChange={(e) => setAction(e.target.value as RuleAction)} className="input w-full mt-1">
                <option value="allow">Allow</option>
                <option value="ask">Ask</option>
                <option value="deny">Deny</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-fg-subtle">Pattern (optional)</label>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="input w-full mt-1 font-mono text-xs"
              placeholder="substring or /regex/ matched against JSON args"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-fg-subtle">Scope</label>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'global' | 'project')} className="input w-full mt-1">
                <option value="global">Global</option>
                <option value="project">Project</option>
              </select>
            </div>
            {scope === 'project' && (
              <div>
                <label className="text-sm text-fg-subtle">Project</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input w-full mt-1">
                  <option value="">Pick a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {formError && <div className="text-sm text-danger">{formError}</div>}
          <div className="flex justify-end">
            <button onClick={() => void handleAdd()} disabled={saving} className="btn-primary disabled:opacity-60">
              {saving ? 'Adding…' : 'Add rule'}
            </button>
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={() => setShowTools((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg transition mb-2"
        >
          <span className={`inline-block transition-transform ${showTools ? 'rotate-90' : ''}`}>›</span>
          Registered tools ({tools.length})
        </button>
        {showTools && (
          <>
            <p className="text-xs text-fg-muted mb-3">Built-in and MCP-provided tools available to the model.</p>
            <div className="space-y-2">
              {tools.map((t) => (
                <div key={t.name} className="p-3 bg-bg border border-border rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{t.name}</span>
                        <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${t.source === 'builtin' ? 'bg-accent/20 text-accent' : 'bg-success/20 text-success'}`}>
                          {t.source === 'builtin' ? 'built-in' : t.source.replace('mcp:', 'mcp:')}
                        </span>
                      </div>
                      <div className="text-xs text-fg-muted mt-1">{t.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
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
      `}</style>
    </div>
  );
}

// ipcRenderer.invoke wraps handler errors as
// "Error invoking remote method 'channel': Error: message" — unwrap for display.
function ipcErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
