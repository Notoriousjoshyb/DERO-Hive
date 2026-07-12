import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import type { McpServerConfig } from '@shared/types';

// Curated, bundled index of well-known MCP servers (all npx-installable).
// "Add" pre-fills the editor so users can adjust paths/keys before saving.
interface CatalogEntry {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  requires?: string; // human hint about required config
}

const MCP_CATALOG: CatalogEntry[] = [
  {
    name: 'Filesystem',
    description: 'Read/write files in a folder you choose',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\path\\to\\folder'],
    requires: 'Replace the folder path in the arguments'
  },
  {
    name: 'Memory',
    description: 'Persistent knowledge-graph memory across chats',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory']
  },
  {
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning tool',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
  },
  {
    name: 'GitHub',
    description: 'Repos, issues, and PRs via the GitHub API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    requires: 'Set GITHUB_PERSONAL_ACCESS_TOKEN in the environment'
  },
  {
    name: 'Brave Search',
    description: 'Web search via the Brave Search API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    requires: 'Set BRAVE_API_KEY in the environment'
  },
  {
    name: 'Puppeteer',
    description: 'Browser automation — navigate, screenshot, scrape',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer']
  }
];

export function McpPanel(): JSX.Element {
  const statuses = useAppStore((s) => s.mcpStatuses);
  const loadMcpStatuses = useAppStore((s) => s.loadMcpStatuses);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);

  useEffect(() => { void loadMcpStatuses(); }, []);

  const list = useAppStore.getState().mcpStatuses.length > 0 ? useAppStore.getState().mcpStatuses : statuses;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">MCP servers</h3>
          <p className="text-xs text-fg-muted mt-1">Model Context Protocol — give the model access to external tools, data, and prompts.</p>
        </div>
        <button
          onClick={() => setEditing({ id: `mcp-${Date.now()}`, name: '', enabled: true, transport: 'stdio', command: '', args: [], env: {} })}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
          Add server
        </button>
      </div>

      {list.length === 0 ? (
        <div className="text-sm text-fg-muted p-5 bg-bg-elev/50 border border-border rounded-xl">
          No MCP servers configured. Click <strong className="text-fg">Add server</strong> to register one.
          <div className="text-xs mt-2 text-fg-subtle">
            Tip: <code className="bg-bg-sidebar border border-border px-1.5 py-0.5 rounded font-mono">npx -y @modelcontextprotocol/server-filesystem /path/to/dir</code>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <div key={s.id} className="p-3.5 bg-bg-elev/50 border border-border rounded-xl hover:border-border-strong transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.connected ? 'bg-success' : s.error ? 'bg-danger' : 'bg-fg-subtle'}`} />
                    <span className="font-medium text-fg">{s.name}</span>
                    {s.connected && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/15 text-success font-medium">connected</span>}
                  </div>
                  {s.error && <div className="text-xs text-danger mt-1.5">{s.error}</div>}
                  <div className="text-xs text-fg-subtle mt-1.5">
                    {s.tools.length} tools · {s.resources.length} resources · {s.prompts.length} prompts
                  </div>
                  {s.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.tools.slice(0, 8).map((t) => (
                        <span key={t.name} className="text-[10px] px-1.5 py-0.5 bg-bg-sidebar border border-border rounded text-fg-muted font-mono">{t.name}</span>
                      ))}
                      {s.tools.length > 8 && <span className="text-[10px] text-fg-subtle self-center">+{s.tools.length - 8} more</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => { if (s.connected) void window.hive.mcpDisconnect(s.id); else void window.hive.mcpConnect(s.id); }}
                    className="px-3 py-1.5 rounded-lg border border-border bg-bg-input hover:bg-bg-elev hover:border-border-strong text-fg text-xs transition"
                  >
                    {s.connected ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DiscoverSection
        installedNames={list.map((s) => s.name.toLowerCase())}
        onAdd={(entry) => setEditing({
          id: `mcp-${Date.now()}`,
          name: entry.name,
          enabled: true,
          transport: 'stdio',
          command: entry.command,
          args: [...entry.args],
          env: { ...(entry.env || {}) }
        })}
      />

      {editing && (
        <McpEditor cfg={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void loadMcpStatuses(); }} />
      )}
    </div>
  );
}

function DiscoverSection({ installedNames, onAdd }: {
  installedNames: string[];
  onAdd: (entry: CatalogEntry) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left py-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg transition"
      >
        <span className="text-[10px]">{open ? '▾' : '▸'}</span>
        Discover
        <span className="text-[10px] font-normal normal-case tracking-normal text-fg-subtle">— known servers, one click to add</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MCP_CATALOG.map((entry) => {
            const installed = installedNames.includes(entry.name.toLowerCase());
            return (
              <div key={entry.name} className="p-3 bg-bg-elev/50 border border-border rounded-xl hover:border-border-strong transition-colors flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg text-sm">{entry.name}</span>
                  <button
                    onClick={() => onAdd(entry)}
                    disabled={installed}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed bg-accent-soft text-accent border border-accent/25 hover:bg-accent hover:text-white"
                  >
                    {installed ? 'Added' : 'Add'}
                  </button>
                </div>
                <p className="text-xs text-fg-muted leading-relaxed">{entry.description}</p>
                <code className="text-[10px] text-fg-subtle font-mono truncate" title={`${entry.command} ${entry.args.join(' ')}`}>
                  {entry.command} {entry.args.join(' ')}
                </code>
                {entry.requires && (
                  <div className="text-[10px] text-warn">⚠ {entry.requires}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function McpEditor({ cfg, onClose, onSaved }: { cfg: McpServerConfig; onClose: () => void; onSaved: () => void }): JSX.Element {
  const [c, setC] = useState<McpServerConfig>(cfg);
  const [envText, setEnvText] = useState(
    Object.entries(c.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')
      || (c.envKeys || []).map((key) => `${key}=`).join('\n')
  );
  const [argsText, setArgsText] = useState((c.args || []).join(' '));
  const [bearerToken, setBearerToken] = useState('');
  const isHttp = c.transport === 'http';

  const save = async (): Promise<void> => {
    const env: Record<string, string> = {};
    envText.split('\n').filter(Boolean).forEach((line) => {
      const [k, ...rest] = line.split('=');
      if (k) env[k.trim()] = rest.join('=').trim();
    });
    const args = argsText.split(/\s+/).filter(Boolean);
    await window.hive.mcpSave({ ...c, env, args, ...(bearerToken ? { bearerToken } : {}) });
    onSaved();
  };

  const canSave = c.name.trim().length > 0 && (isHttp ? (c.url || '').trim().length > 0 : (c.command || '').trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-bg-elev border border-border rounded-2xl shadow-elev-lg max-w-lg w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold tracking-tight">{cfg.name ? 'Edit MCP server' : 'New MCP server'}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-input transition" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-3.5 max-h-[70vh] overflow-y-auto">
          <Field label="Name">
            <input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Filesystem" className="settings-input w-full" autoFocus />
          </Field>
          <Field label="Transport">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg/70 p-1">
              {(['stdio', 'http'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setC({ ...c, transport: t })}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${(c.transport ?? 'stdio') === t ? 'bg-accent text-white shadow-sm' : 'text-fg-muted hover:bg-bg-elev hover:text-fg'}`}
                >
                  {t === 'stdio' ? 'Local command' : 'Remote (HTTP)'}
                </button>
              ))}
            </div>
          </Field>
          {isHttp ? (
            <>
              <Field label="Server URL" hint="Loopback (127.0.0.1/localhost) may use http://; anything else requires https://">
                <input value={c.url || ''} onChange={(e) => setC({ ...c, url: e.target.value })} placeholder="https://example.com/mcp" className="settings-input w-full font-mono text-xs" />
              </Field>
              <Field label="Bearer token" hint={c.hasBearerToken ? 'A token is already saved — leave blank to keep it.' : 'Optional; sent as Authorization: Bearer <token>'}>
                <input
                  type="password"
                  value={bearerToken}
                  onChange={(e) => { setBearerToken(e.target.value); setC({ ...c, clearBearerToken: false }); }}
                  placeholder={c.hasBearerToken ? '••••••••' : 'token'}
                  className="settings-input w-full font-mono text-xs"
                />
                {c.hasBearerToken && (
                  <button type="button" onClick={() => setC({ ...c, clearBearerToken: true })} className="mt-1 text-[10px] font-medium text-danger hover:underline">
                    {c.clearBearerToken ? 'Token will be cleared on save' : 'Clear saved token'}
                  </button>
                )}
              </Field>
            </>
          ) : (
            <>
              <Field label="Command">
                <input value={c.command || ''} onChange={(e) => setC({ ...c, command: e.target.value })} placeholder="npx, python, node…" className="settings-input w-full font-mono text-xs" />
              </Field>
              <Field label="Arguments (space separated)" hint="e.g. -y @modelcontextprotocol/server-filesystem C:\\Users\\you\\projects">
                <input value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem …" className="settings-input w-full font-mono text-xs" />
              </Field>
            </>
          )}
          <Field label="Environment (KEY=VALUE per line)" hint="Useful for API keys, PYTHONPATH, etc. Stored encrypted; leave a value blank to keep the saved one.">
            <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={4} placeholder="API_KEY=…" className="settings-input w-full font-mono text-xs resize-y" />
          </Field>
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-fg-subtle mt-0.5">Connect this server on startup.</div>
            </div>
            <input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} className="accent-accent w-4 h-4" />
          </div>
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-sm font-medium">Trust tools</div>
              <div className="text-xs text-fg-subtle mt-0.5">Skip approval prompts. Only for servers you control.</div>
            </div>
            <input type="checkbox" checked={c.trust || false} onChange={(e) => setC({ ...c, trust: e.target.checked })} className="accent-accent w-4 h-4" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-border bg-bg-input hover:bg-bg-elev hover:border-border-strong text-fg text-sm transition">Cancel</button>
          <button
            onClick={() => void save()}
            disabled={!canSave}
            className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium shadow-elev-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
      <style>{`
        .settings-input {
          background: var(--bg-input);
          border: 1px solid var(--border);
          color: var(--fg);
          padding: 7px 10px;
          border-radius: 8px;
          font-size: 13px;
        }
        .settings-input::placeholder { color: var(--fg-subtle); }
        .settings-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-xs font-medium text-fg-muted mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-fg-subtle mt-1">{hint}</div>}
    </div>
  );
}
