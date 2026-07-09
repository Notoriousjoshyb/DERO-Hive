import { useAppStore } from '../../stores/app';

export function ToolsPanel(): JSX.Element {
  const tools = useAppStore((s) => s.tools);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle mb-2">Available tools</h3>
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
      </div>
    </div>
  );
}