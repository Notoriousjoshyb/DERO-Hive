import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import type { McpRegistry, McpRegistryEntry, McpServerConfig } from '@shared/types';
import { McpEditor } from './McpPanel';

const PLACEHOLDER_RE = /^<.+>$/;

function toConfig(entry: McpRegistryEntry): McpServerConfig {
  if (entry.install.transport === 'http') {
    return {
      id: `reg-${entry.id}`,
      name: entry.name,
      enabled: true,
      transport: 'http',
      url: entry.install.url,
      trust: false
    };
  }
  return {
    id: `reg-${entry.id}`,
    name: entry.name,
    enabled: true,
    transport: 'stdio',
    command: entry.install.command,
    args: [...entry.install.args],
    env: {}
  };
}

function needsSetup(entry: McpRegistryEntry): boolean {
  return !!entry.requiresConfig
    || (entry.install.transport !== 'http' && entry.install.args.some((a) => PLACEHOLDER_RE.test(a)));
}

export function DiscoverPanel(): JSX.Element {
  const loadMcpStatuses = useAppStore((s) => s.loadMcpStatuses);
  const [registry, setRegistry] = useState<McpRegistry | null>(null);
  const [installed, setInstalled] = useState<McpServerConfig[]>([]);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshInstalled = async (): Promise<void> => {
    setInstalled(await window.hive.mcpList());
  };

  useEffect(() => {
    void window.hive.mcpRegistry().then(setRegistry);
    void refreshInstalled();
  }, []);

  const isAdded = (entry: McpRegistryEntry): boolean =>
    installed.some((c) =>
      c.id === `reg-${entry.id}`
      || (entry.install.transport === 'http'
        ? c.transport === 'http' && c.url === entry.install.url
        : c.transport !== 'http'
          && c.command === entry.install.command
          && JSON.stringify(c.args ?? []) === JSON.stringify(entry.install.args))
    );

  const add = async (entry: McpRegistryEntry): Promise<void> => {
    // Entries with placeholders (e.g. <ALLOWED_DIR>) need the user to complete
    // the arguments first — open the editor prefilled instead of adding blindly.
    if (needsSetup(entry)) {
      setEditing(toConfig(entry));
      return;
    }
    setBusyId(entry.id);
    try {
      await window.hive.mcpSave(toConfig(entry));
      await refreshInstalled();
      void loadMcpStatuses();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Discover MCP servers</h3>
        <p className="text-xs text-fg-muted mt-1">
          A curated set of verified servers you can add with one click.
        </p>
      </div>

      {!registry ? (
        <div className="text-sm text-fg-muted p-5 bg-bg-elev/50 border border-border rounded-xl">Loading registry…</div>
      ) : registry.servers.length === 0 ? (
        <div className="text-sm text-fg-muted p-5 bg-bg-elev/50 border border-border rounded-xl">
          The bundled server registry could not be loaded.
        </div>
      ) : (
        <div className="space-y-2">
          {registry.servers.map((entry) => {
            const added = isAdded(entry);
            return (
              <div key={entry.id} className="p-3.5 bg-bg-elev/50 border border-border rounded-xl hover:border-border-strong transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-fg">{entry.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-sidebar border border-border text-fg-muted font-mono">{entry.runtime}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent font-medium">{entry.category}</span>
                      {entry.runtime === 'python' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warn/15 text-warn font-medium">requires uv</span>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted mt-1.5">{entry.description}</div>
                    <div className="flex items-center gap-3 text-[10px] text-fg-subtle mt-2">
                      <span>{entry.license}</span>
                      {typeof entry.stars === 'number' && entry.stars > 0 && <span>★ {entry.stars.toLocaleString()}</span>}
                      <button
                        onClick={() => void window.hive.openExternal(entry.repo)}
                        className="underline hover:text-fg transition-colors"
                      >
                        repository
                      </button>
                      <code className="bg-bg-sidebar border border-border px-1.5 py-0.5 rounded font-mono">
                        {entry.install.transport === 'http'
                          ? entry.install.url
                          : `${entry.install.command} ${entry.install.args.join(' ')}`}
                      </code>
                    </div>
                    {entry.requiresConfig && (
                      <div className="text-[10px] text-fg-subtle mt-1.5">{entry.requiresConfig}</div>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {added ? (
                      <span className="inline-flex items-center px-3 py-1.5 text-xs text-success font-medium">Added ✓</span>
                    ) : (
                      <button
                        onClick={() => void add(entry)}
                        disabled={busyId === entry.id}
                        className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium shadow-elev-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {busyId === entry.id ? 'Adding…' : needsSetup(entry) ? 'Add…' : 'Add'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {registry?.updatedAt && (
        <p className="text-[10px] text-fg-subtle">
          Registry snapshot from {registry.updatedAt}. Servers marked "requires uv" need the uv Python toolchain installed; node servers need Node.js.
        </p>
      )}

      {editing && (
        <McpEditor
          cfg={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refreshInstalled();
            void loadMcpStatuses();
          }}
        />
      )}
    </div>
  );
}
