import { useEffect, useState } from 'react';
import type { SimulatorStatus, McpServerStatus } from '@shared/types';

/**
 * Sidebar footer widget for local services: MCP servers (connection status +
 * connect/disconnect toggle each) and the bundled DERO blockchain simulator
 * (status dot + on/off toggle).
 */
export function SimulatorPanel(): JSX.Element {
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [mcp, setMcp] = useState<McpServerStatus[]>([]);
  const [mcpPending, setMcpPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    void window.hive.simulatorStatus().then((s) => { if (mounted) setStatus(s); });
    void window.hive.mcpStatus().then((s) => { if (mounted) setMcp(s); });
    const offStatus = window.hive.onSimulatorStatus((s) => setStatus(s));
    const offMcp = window.hive.onMcpChanged((s) => setMcp(s));
    return () => { mounted = false; offStatus(); offMcp(); };
  }, []);

  const running = !!status?.running;
  const installed = !!status?.installed;

  const toggleSimulator = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      setStatus(running ? await window.hive.simulatorStop() : await window.hive.simulatorStart());
    } finally {
      setPending(false);
    }
  };

  const toggleMcp = async (id: string, connected: boolean): Promise<void> => {
    if (mcpPending.has(id)) return;
    setMcpPending((prev) => new Set(prev).add(id));
    try {
      if (connected) await window.hive.mcpDisconnect(id);
      else await window.hive.mcpConnect(id);
    } catch { /* the refreshed status below shows the error */ }
    finally {
      setMcpPending((prev) => { const n = new Set(prev); n.delete(id); return n; });
      try { setMcp(await window.hive.mcpStatus()); } catch { /* ignore */ }
    }
  };

  const simDot = running
    ? 'bg-emerald-500'
    : status?.error
    ? 'bg-danger'
    : 'bg-danger';

  const simTitle = !installed
    ? 'Simulator binary not found — run "npm run setup:simulator"'
    : status?.error
    ? status.error
    : running
    ? `Running (pid ${status?.pid ?? '?'}) — RPC on 127.0.0.1:20000`
    : 'Stopped';

  return (
    <div className="border-t border-border">
      {/* MCP servers */}
      {mcp.length > 0 && (
        <div className="max-h-32 overflow-y-auto">
          {mcp.map((s) => (
            <ServiceRow
              key={s.id}
              label={s.name}
              dotClass={s.connected ? 'bg-emerald-500' : s.error ? 'bg-danger' : 'bg-fg-subtle/50'}
              title={s.error ? s.error : s.connected ? `Connected — ${s.tools.length} tools` : 'Disconnected'}
              on={s.connected}
              pending={mcpPending.has(s.id)}
              disabled={false}
              onToggle={() => void toggleMcp(s.id, s.connected)}
            />
          ))}
        </div>
      )}

      {/* Simulator */}
      <ServiceRow
        label="DERO Simulator"
        dotClass={`${simDot} ${running ? 'animate-pulse' : ''}`}
        title={simTitle}
        on={running}
        pending={pending}
        disabled={!installed && !running}
        onToggle={() => void toggleSimulator()}
      />
    </div>
  );
}

function ServiceRow({
  label,
  dotClass,
  title,
  on,
  pending,
  disabled,
  onToggle
}: {
  label: string;
  dotClass: string;
  title: string;
  on: boolean;
  pending: boolean;
  disabled: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5" title={title}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
      <span className="flex-1 min-w-0 truncate text-[11px] text-fg-muted">{label}</span>
      <button
        onClick={onToggle}
        disabled={pending || disabled}
        role="switch"
        aria-checked={on}
        aria-label={`${on ? 'Turn off' : 'Turn on'} ${label}`}
        title={disabled ? title : on ? `Turn off ${label}` : `Turn on ${label}`}
        className={`relative w-8 h-[18px] rounded-full flex-shrink-0 transition-colors duration-150 ${
          on ? 'bg-emerald-600' : 'bg-bg-elev border border-border'
        } ${pending ? 'opacity-60 cursor-wait' : disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all duration-150 ${
            on ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  );
}
