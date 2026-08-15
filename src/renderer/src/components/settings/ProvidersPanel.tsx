import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/app';
import { isAcpPreset } from '@shared/presets';
import type { OAuthStatus, ProviderConfig } from '@shared/types';

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
  // Browser sign-in (OAuth device flow) — at most one provider at a time.
  const [oauthFlow, setOauthFlow] = useState<{ providerId: string; status: OAuthStatus } | null>(null);

  // While a sign-in is pending, poll main for completion (the confirmation
  // happens in the external browser, so there is no renderer-side event).
  useEffect(() => {
    if (oauthFlow?.status.state !== 'pending') return;
    const providerId = oauthFlow.providerId;
    const interval = setInterval(async () => {
      try {
        const status = await window.hive.providerOauthStatus(providerId);
        setOauthFlow((cur) => (cur?.providerId === providerId ? { providerId, status } : cur));
        if (status.state === 'signed-in') {
          await loadProviders();
        }
      } catch { /* transient IPC failure — keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [oauthFlow?.status.state, oauthFlow?.providerId, loadProviders]);

  const startSignIn = async (providerId: string): Promise<void> => {
    const status = await window.hive.providerOauthStart(providerId);
    setOauthFlow({ providerId, status });
  };

  // Quick add via browser sign-in: create the provider from preset defaults
  // (no API key), then launch the device flow. If a provider for this preset
  // already exists, sign in on it instead of adding a duplicate.
  const [quickSignInBusy, setQuickSignInBusy] = useState<string | null>(null);
  const quickSignIn = async (presetId: string): Promise<void> => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || quickSignInBusy) return;
    setQuickSignInBusy(presetId);
    try {
      const existing = providers.find((p) => p.presetId === presetId);
      let id = existing?.id;
      if (!id) {
        const saved = await window.hive.providerSave({
          id: '',
          presetId: preset.id,
          name: preset.name,
          baseUrl: preset.baseUrl,
          enabled: true,
          models: preset.models || []
        });
        id = saved.id;
        await loadProviders();
      }
      await startSignIn(id);
    } finally {
      setQuickSignInBusy(null);
    }
  };

  // Quick add for ACP agents (Codex/ChatGPT, Claude Code): browser auth runs
  // through the adapter's model discovery, not the generic OAuth device flow.
  // Saving a new ACP provider auto-starts discovery (and opens the vendor's
  // login); for an existing provider we trigger a refresh, which does the same.
  const quickAcpSignIn = async (presetId: string): Promise<void> => {
    if (quickSignInBusy) return;
    setQuickSignInBusy(presetId);
    try {
      const preset = presets.find((p) => p.id === presetId);
      const existing = providers.find((p) => p.presetId === presetId);
      if (existing) {
        const r = await window.hive.providerRefreshModels(existing.id);
        if (!r.ok) alert(`Sign-in failed: ${r.error || 'unknown error'}`);
      } else {
        await window.hive.providerSave({
          id: '',
          presetId,
          name: preset?.name || presetId,
          baseUrl: '',
          enabled: true,
          models: []
        });
      }
      await loadProviders();
    } finally {
      setQuickSignInBusy(null);
    }
  };

  // Generic "sign in and grab a key" path for providers whose vendors don't
  // permit third-party OAuth: open their key page (login happens there) and
  // the add form together so the key can be pasted straight in.
  const quickGetKey = (presetId: string): void => {
    const preset = presets.find((p) => p.id === presetId);
    if (preset?.apiKeyUrl) void window.hive.openExternal(preset.apiKeyUrl);
    startNew(presetId);
  };

  const signOut = async (providerId: string): Promise<void> => {
    await window.hive.providerOauthSignOut(providerId);
    setOauthFlow((cur) => (cur?.providerId === providerId ? null : cur));
    await loadProviders();
  };

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
    if (isAcpPreset(editing.presetId)) return; // ACP agents discover models via their adapter, not HTTP
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
                      {p.hasOAuth && <span className="text-[10px] text-success uppercase">signed in</span>}
                      {p.modelsFetchedAt && <span className="text-[10px] text-accent uppercase">live models</span>}
                    </div>
                    <div className="text-xs text-fg-subtle font-mono truncate">{p.baseUrl}</div>
                    <div className="text-xs text-fg-muted mt-1">
                      {p.models.length} models
                      {p.modelsFetchedAt && (
                        <span className="text-fg-subtle"> · updated {timeAgo(p.modelsFetchedAt)}</span>
                      )}
                      {!p.hasApiKey && !p.hasOAuth && (
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
                    {presets.find((pp) => pp.id === p.presetId)?.supportsBrowserSignIn && (
                      p.hasOAuth ? (
                        <button onClick={() => void signOut(p.id)} className="btn-secondary" title="Remove the browser sign-in session">
                          Sign out
                        </button>
                      ) : (
                        <button
                          onClick={() => void startSignIn(p.id)}
                          disabled={oauthFlow?.providerId === p.id && oauthFlow.status.state === 'pending'}
                          className="btn-secondary text-accent"
                          title="Sign in with your account in the browser — no API key needed"
                        >
                          Sign in
                        </button>
                      )
                    )}
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
                {oauthFlow?.providerId === p.id && oauthFlow.status.state === 'pending' && (
                  <div className="mt-2 p-2 rounded-lg bg-accent-soft border border-accent/30 text-xs space-y-1">
                    <div className="text-fg">
                      Confirm the sign-in in your browser. Your code:{' '}
                      <span className="font-mono font-semibold tracking-wider">{oauthFlow.status.userCode}</span>
                    </div>
                    <div className="text-fg-muted">
                      No browser window?{' '}
                      <button
                        onClick={() => { const s = oauthFlow.status; if (s.state === 'pending') void window.hive.openExternal(s.verificationUri); }}
                        className="text-accent hover:underline"
                      >
                        Open the verification page
                      </button>
                      {' '}·{' '}
                      <button onClick={() => void signOut(p.id)} className="text-fg-subtle hover:text-fg hover:underline">Cancel</button>
                    </div>
                  </div>
                )}
                {oauthFlow?.providerId === p.id && oauthFlow.status.state === 'error' && (
                  <div className="mt-2 p-2 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger">
                    {oauthFlow.status.error}
                  </div>
                )}
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
                {preset.supportsBrowserSignIn ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => void quickSignIn(preset.id)}
                      disabled={quickSignInBusy === preset.id}
                      className="btn-primary text-[11px]"
                      title="Add this provider and sign in with your account in the browser — no API key needed"
                    >
                      {quickSignInBusy === preset.id ? 'Opening browser…' : 'Sign in with browser'}
                    </button>
                    <button
                      onClick={() => startNew(preset.id)}
                      className="btn-secondary text-[11px]"
                      title="Add this provider with an API key instead"
                    >
                      Enter API key
                    </button>
                  </div>
                ) : isAcpPreset(preset.id) ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => void quickAcpSignIn(preset.id)}
                      disabled={quickSignInBusy === preset.id}
                      className="btn-primary text-[11px]"
                      title={preset.id === 'codex'
                        ? 'Add this provider and log in with your ChatGPT account in the browser — no API key needed'
                        : 'Add this provider and sign in with your Claude Pro/Max account via Anthropic\'s own Claude Code — no API key needed'}
                    >
                      {quickSignInBusy === preset.id
                        ? 'Opening login…'
                        : preset.id === 'codex' ? 'Sign in with ChatGPT' : 'Sign in with Claude'}
                    </button>
                    <button
                      onClick={() => startNew(preset.id)}
                      className="btn-secondary text-[11px]"
                      title="Configure the adapter command path manually"
                    >
                      Manual setup
                    </button>
                  </div>
                ) : preset.apiKeyUrl ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => quickGetKey(preset.id)}
                      className="btn-primary text-[11px]"
                      title="Sign in on the provider's site to create a key, and open the add form to paste it"
                    >
                      Get API key ↗
                    </button>
                    <button
                      onClick={() => startNew(preset.id)}
                      className="btn-secondary text-[11px]"
                      title="Add this provider and paste a key you already have"
                    >
                      Enter API key
                    </button>
                  </div>
                ) : null}
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
            {!isAcpPreset(editing.presetId) && (
              <Field label="Base URL">
                <input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} className="input w-full font-mono text-xs" />
              </Field>
            )}
            {isAcpPreset(editing.presetId) && (
              <>
                <div className="text-xs text-fg-subtle bg-bg-input border border-border rounded p-2">
                  {editing.presetId === 'codex' ? (
                    <>Codex uses the <code className="font-mono text-[10px]">@agentclientprotocol/codex-acp</code> adapter. Save the provider, then click <b>Models</b> to open the ChatGPT login page and load the model list. No API key is required.</>
                  ) : (
                    <>Claude Code runs through the <code className="font-mono text-[10px]">@zed-industries/claude-code-acp</code> adapter and uses your Claude Pro/Max subscription. Save the provider, then click <b>Models</b> to sign in — an existing <code className="font-mono text-[10px]">claude</code> CLI login is picked up automatically, or run <code className="font-mono text-[10px]">claude /login</code> in a terminal. No API key is required.</>
                  )}
                </div>
                <Field label="Adapter command path" hint="Path to the adapter binary or 'npx'. Leave blank to use the bundled node_modules copy or npx fallback.">
                  <input
                    value={editing.customHeaders?.commandPath || ''}
                    onChange={(e) => setEditing({ ...editing, customHeaders: { ...editing.customHeaders, commandPath: e.target.value } })}
                    placeholder={editing.presetId === 'codex'
                      ? 'node_modules/@agentclientprotocol/codex-acp/dist/index.js'
                      : 'node_modules/@zed-industries/claude-code-acp/dist/index.js'}
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
                  <span className="text-[10px] text-fg-subtle ml-2">Hide browser-based auth (e.g., for remote/headless setups)</span>
                </Field>
              </>
            )}
            {!isAcpPreset(editing.presetId) && (
              <Field
                label="API key (optional)"
                hint={
                  editing.hasApiKey ? 'Key saved. Leave blank to keep current; type a new value to replace.'
                  : presets.find((pp) => pp.id === editing.presetId)?.supportsBrowserSignIn
                    ? 'Optional — this provider supports browser sign-in. Save it, then click "Sign in" on the provider card to use your account without an API key.'
                    : 'Paste your API key if required. Some providers (e.g. local Ollama) do not need one.'
                }
              >
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
