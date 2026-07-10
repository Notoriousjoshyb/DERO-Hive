import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/app';
import type { ProviderConfig } from '@shared/types';

export function ProvidersPanel(): JSX.Element {
  const providers = useAppStore((s) => s.providers);
  const presets = useAppStore((s) => s.presets);
  const saveProvider = useAppStore((s) => s.saveProvider);
  const deleteProvider = useAppStore((s) => s.deleteProvider);
  const testProvider = useAppStore((s) => s.testProvider);
  const loadProviders = useAppStore((s) => s.loadProviders);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeSeq = useRef(0);

  const startNew = (presetId?: string): void => {
    const preset = presetId ? presets.find((p) => p.id === presetId) : undefined;
    setEditing({
      id: '',
      presetId: preset?.id,
      name: preset?.name || 'Custom',
      baseUrl: preset?.baseUrl || '',
      enabled: true,
      models: preset?.models || []
    });
    setApiKey('');
    setSaveError(null);
    setProbeError(null);
  };

  // Auto-probe models when baseUrl is present in the form
  useEffect(() => {
    if (!editing) return;
    if (editing.presetId === 'codex') return; // Codex discovers models via ACP, not HTTP
    if (!editing.baseUrl) return;

    if (probeTimer.current) clearTimeout(probeTimer.current);
    setProbeError(null);

    const seq = ++probeSeq.current;
    probeTimer.current = setTimeout(async () => {
      setProbing(true);
      try {
        const r = await window.hive.providerProbeModels({
          baseUrl: editing.baseUrl,
          apiKey,
          presetId: editing.presetId,
          customHeaders: editing.customHeaders
        });
        if (seq !== probeSeq.current) return; // stale
        if (r.ok && r.models && r.models.length > 0) {
          // Merge: keep existing metadata (contextWindow, capabilities) for IDs we know
          const existing = new Map(editing.models.map((m) => [m.id, m]));
          const merged = r.models.map((id) => existing.get(id) || { id, name: id });
          setEditing({ ...editing, models: merged });
        } else if (!r.ok) {
          setProbeError(r.error || 'Could not fetch models');
        }
      } catch (err) {
        if (seq === probeSeq.current) setProbeError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === probeSeq.current) setProbing(false);
      }
    }, 600);

    return () => {
      if (probeTimer.current) clearTimeout(probeTimer.current);
    };
  }, [apiKey, editing?.baseUrl, editing?.presetId]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    setSaveError(null);
    setSaving(true);
    try {
      await saveProvider({ ...editing, apiKey: apiKey || undefined });
      setEditing(null);
      setApiKey('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: string): Promise<void> => {
    const r = await testProvider(id);
    if (r.ok) {
      await loadProviders();
      alert(`✓ Connection OK${r.models ? ` (${r.models.length} models)` : ''}`);
    } else {
      const lines = [`✗ ${r.error || 'failed'}`];
      if (r.hint) lines.push(`\nHint: ${r.hint}`);
      alert(lines.join('\n'));
    }
  };

  const handleRefreshModels = async (id: string): Promise<void> => {
    setRefreshing(id);
    try {
      const r = await window.hive.providerRefreshModels(id);
      if (r.ok) {
        await loadProviders();
      } else {
        alert(`Could not refresh models: ${r.error || 'unknown error'}`);
      }
    } finally {
      setRefreshing(null);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Configured providers</h3>
          <button onClick={() => loadProviders()} className="text-xs text-fg-muted hover:text-fg">↻ Reload</button>
        </div>
        {providers.length === 0 ? (
          <div className="text-sm text-fg-muted">No providers yet. Add one from the presets below.</div>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <div key={p.id} className="p-3 bg-bg border border-border rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {!p.enabled && <span className="text-[10px] text-fg-subtle uppercase">(disabled)</span>}
                      {p.hasApiKey && <span className="text-[10px] text-success uppercase">key saved</span>}
                      {p.modelsFetchedAt && <span className="text-[10px] text-accent uppercase">live models</span>}
                    </div>
                    <div className="text-xs text-fg-subtle font-mono truncate">{p.baseUrl}</div>
                    <div className="text-xs text-fg-muted mt-1">
                      {p.models.length} models
                      {p.modelsFetchedAt && (
                        <span className="text-fg-subtle"> · updated {timeAgo(p.modelsFetchedAt)}</span>
                      )}
                      {!p.hasApiKey && (
                        <span className="text-warn"> · no API key</span>
                      )}
                    </div>
                    {(() => {
                      const preset = p.presetId ? presets.find((pp) => pp.id === p.presetId) : undefined;
                      if (preset?.apiKeyUrl) {
                        return (
                          <button
                            onClick={() => void window.hive.openExternal(preset.apiKeyUrl!)}
                            className="text-[10px] text-accent hover:underline mt-1 inline-block"
                          >
                            Get API key ↗
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                    <button
                      onClick={() => void handleRefreshModels(p.id)}
                      disabled={refreshing === p.id}
                      className="btn-secondary"
                      title="Fetch live model list from provider"
                    >
                      {refreshing === p.id ? '⟳ Fetching…' : '↻ Models'}
                    </button>
                    <button onClick={() => void handleTest(p.id)} className="btn-secondary">Test</button>
                    <button onClick={() => { setEditing(p); setApiKey(''); setSaveError(null); }} className="btn-secondary">Edit</button>
                    <button onClick={() => { if (confirm(`Delete ${p.name}?`)) void deleteProvider(p.id); }} className="btn-secondary text-danger">×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

<div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle mb-3">Quick add</h3>
          <div className="grid grid-cols-2 gap-2">
            {presets.filter((p) => p.id !== 'custom').map((preset) => (
              <div key={preset.id} className="text-left p-3 bg-bg hover:bg-bg-input border border-border rounded-lg transition">
                <button onClick={() => startNew(preset.id)} className="w-full text-left">
                  <div className="font-medium text-sm">{preset.name}</div>
                  <div className="text-[10px] text-fg-subtle font-mono mt-0.5 truncate">{preset.baseUrl || '(no URL — set manually)'}</div>
                  {preset.notes && <div className="text-xs text-fg-muted mt-1">{preset.notes}</div>}
                </button>
                {preset.docsUrl && (
                  <button
                    onClick={(e) => { e.stopPropagation(); void window.hive.openExternal(preset.docsUrl!); }}
                    className="text-[10px] text-accent hover:underline mt-2 inline-block"
                  >
                    View docs ↗
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-bg-elev border border-border rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">{editing.id ? 'Edit provider' : 'Add provider'}</h3>
            <Field label="Name">
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="input w-full" />
            </Field>
            {editing.presetId !== 'codex' && (
              <Field label="Base URL">
                <input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} className="input w-full font-mono text-xs" />
              </Field>
            )}
            {editing.presetId === 'codex' && (
              <>
                <div className="text-xs text-fg-subtle bg-bg-input border border-border rounded p-2">
                  Codex uses the <code className="font-mono text-[10px]">@agentclientprotocol/codex-acp</code> adapter. Save the provider, then click <b>Models</b> to open the ChatGPT login page and load the model list. No API key is required.
                </div>
                <Field label="codex-acp command path" hint="Path to the codex-acp binary or 'npx'. Leave blank to use the bundled node_modules copy or npx fallback.">
                  <input
                    value={editing.customHeaders?.commandPath || ''}
                    onChange={(e) => setEditing({ ...editing, customHeaders: { ...editing.customHeaders, commandPath: e.target.value } })}
                    placeholder="node_modules/@agentclientprotocol/codex-acp/dist/index.js"
                    className="input w-full font-mono text-xs"
                  />
                </Field>
                <Field label="Headless / no browser">
                  <input
                    type="checkbox"
                    checked={editing.customHeaders?.noBrowser === '1'}
                    onChange={(e) => setEditing({ ...editing, customHeaders: { ...editing.customHeaders, noBrowser: e.target.checked ? '1' : '' } })}
                    className="accent-accent w-4 h-4"
                  />
                  <span className="text-[10px] text-fg-subtle ml-2">Hide browser-based ChatGPT auth (e.g., for remote/headless setups)</span>
                </Field>
              </>
            )}
            {editing.presetId !== 'codex' && (
              <Field label="API key (optional)" hint={editing.hasApiKey ? 'Key saved. Leave blank to keep current; type a new value to replace.' : 'Paste your API key if required. Some providers (e.g. local Ollama) do not need one.'}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editing.hasApiKey ? '•••••••• (saved)' : 'Paste your API key'}
                  className="input w-full font-mono text-xs"
                />
                {probing && (
                  <div className="text-[10px] text-accent mt-1 flex items-center gap-1">
                    <span className="dot-flashing" /> Fetching live model list…
                  </div>
                )}
                {!probing && probeError && (
                  <div className="text-[10px] text-warn mt-1">Could not auto-fetch models: {probeError}</div>
                )}
                {!probing && !probeError && editing.models.length > 0 && (
                  <div className="text-[10px] text-success mt-1">
                    ✓ {editing.models.length} model{editing.models.length === 1 ? '' : 's'} loaded
                  </div>
                )}
              </Field>
            )}
            <Field label="Enabled">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} className="accent-accent w-4 h-4" />
            </Field>
            {saveError && (
              <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded p-2">{saveError}</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => void handleSave()} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input { background: var(--bg-input); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 6px; font-size: 13px; }
        .input:focus { outline: none; border-color: var(--accent); }
        .btn-secondary { background: var(--bg-input); border: 1px solid var(--border); color: var(--fg); padding: 5px 10px; border-radius: 6px; font-size: 12px; }
        .btn-secondary:hover:not(:disabled) { background: var(--bg-elev); }
        .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: var(--accent); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-xs font-medium text-fg-muted mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-fg-subtle mt-1">{hint}</div>}
    </div>
  );
}
