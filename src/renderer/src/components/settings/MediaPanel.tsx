import { useEffect, useMemo, useState } from 'react';
import type { MediaProviderConfig, MediaProviderPreset, MediaModelOption, MediaKind } from '@shared/types';

// Settings → Media: manage image / video / audio generation providers.
export function MediaPanel(): JSX.Element {
  const [providers, setProviders] = useState<MediaProviderConfig[]>([]);
  const [presets, setPresets] = useState<MediaProviderPreset[]>([]);
  const [adding, setAdding] = useState(false);

  const load = async (): Promise<void> => {
    const res = await window.hive.mediaList();
    setProviders(res.providers);
    setPresets(res.presets);
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold mb-1">Media generation</h3>
        <p className="text-xs text-fg-muted leading-relaxed">
          Your connected <span className="text-fg">model providers</span> already contribute media automatically —
          when their model list is pulled, image / speech models are detected and appear in
          <span className="text-fg"> Vision → Media</span>. Add a provider here for anything a chat provider can't do:
          video, music, local generators (ComfyUI / A1111), or key-free services. Keys are stored encrypted in the main process.
        </p>
      </div>

      {/* Configured providers */}
      <div className="space-y-2">
        {providers.length === 0 ? (
          <div className="text-xs text-fg-muted border border-dashed border-border rounded-lg p-4 text-center">
            No media providers yet. Add one below to start generating.
          </div>
        ) : (
          providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              preset={presets.find((x) => x.id === p.presetId)}
              onChanged={load}
            />
          ))
        )}
      </div>

      {/* Add provider */}
      {adding ? (
        <AddProviderForm presets={presets} onDone={() => { setAdding(false); void load(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 transition"
        >
          + Add media provider
        </button>
      )}
    </div>
  );
}

function ProviderRow({ provider, preset, onChanged }: { provider: MediaProviderConfig; preset?: MediaProviderPreset; onChanged: () => void }): JSX.Element {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; hint?: string } | null>(null);

  const test = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await window.hive.mediaTestProvider(provider.id));
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async (): Promise<void> => {
    await window.hive.mediaSaveProvider({ ...provider, enabled: !provider.enabled });
    onChanged();
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Remove media provider "${provider.name}"?`)) return;
    await window.hive.mediaDeleteProvider(provider.id);
    onChanged();
  };

  const kindLabel = preset ? (preset.kind === 'both' ? 'image · video' : preset.kind) : '';

  return (
    <div className="border border-border rounded-lg p-3 bg-bg-elev">
      <div className="flex items-center gap-2">
        <button
          onClick={() => void toggleEnabled()}
          title={provider.enabled ? 'Enabled' : 'Disabled'}
          className={`w-8 h-4.5 rounded-full relative transition-colors flex-shrink-0 ${provider.enabled ? 'bg-accent' : 'bg-border'}`}
        >
          <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${provider.enabled ? 'left-4' : 'left-0.5'}`} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{provider.name}</div>
          <div className="text-[11px] text-fg-subtle truncate">
            {preset?.name || provider.presetId}{kindLabel ? ` · ${kindLabel}` : ''}
            {provider.hasApiKey ? ' · key set' : preset?.requiresApiKey ? ' · no key' : ''}
          </div>
        </div>
        <button onClick={() => void test()} disabled={testing} className="text-[11px] px-2 py-1 rounded border border-border text-fg-muted hover:text-fg disabled:opacity-40">
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button onClick={() => void remove()} className="text-[11px] px-2 py-1 rounded text-danger/80 hover:text-danger hover:bg-danger/10">
          Remove
        </button>
      </div>
      {result && (
        <div className={`mt-2 text-[11px] ${result.ok ? 'text-success' : 'text-danger'}`}>
          {result.ok ? '✓ Connection OK' : `✗ ${result.error || 'Failed'}${result.hint ? ` — ${result.hint}` : ''}`}
        </div>
      )}
    </div>
  );
}

function firstModel(models: MediaModelOption[], kind: MediaKind): string | undefined {
  return models.find((m) => m.kind === kind)?.id;
}

function AddProviderForm({ presets, onDone, onCancel }: { presets: MediaProviderPreset[]; onDone: () => void; onCancel: () => void }): JSX.Element {
  const [presetId, setPresetId] = useState(presets[0]?.id || '');
  const preset = useMemo(() => presets.find((p) => p.id === presetId), [presets, presetId]);
  const [name, setName] = useState(preset?.name || '');
  const [baseUrl, setBaseUrl] = useState(preset?.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset dependent fields when the preset changes.
  useEffect(() => {
    setName(preset?.name || '');
    setBaseUrl(preset?.baseUrl || '');
    setApiKey('');
  }, [preset]);

  const save = async (): Promise<void> => {
    if (!preset) return;
    setSaving(true);
    setError(null);
    const cfg: MediaProviderConfig & { apiKey?: string } = {
      id: '',
      presetId: preset.id,
      name: name.trim() || preset.name,
      baseUrl: baseUrl.trim(),
      hasApiKey: false,
      enabled: true,
      defaultImageModel: firstModel(preset.models, 'image'),
      defaultVideoModel: firstModel(preset.models, 'video'),
      defaultAudioModel: firstModel(preset.models, 'audio'),
      updatedAt: Date.now(),
      apiKey: apiKey.trim() || undefined
    };
    try {
      const res = await window.hive.mediaSaveProvider(cfg);
      if (res.ok) onDone();
      else setError(res.error || 'Failed to save');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-bg-elev space-y-3">
      <div className="text-sm font-medium">Add media provider</div>

      <label className="block">
        <span className="text-[11px] text-fg-muted">Provider</span>
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="mt-1 w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      {preset?.notes && <p className="text-[11px] text-fg-subtle leading-relaxed">{preset.notes}</p>}

      <label className="block">
        <span className="text-[11px] text-fg-muted">Display name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
        />
      </label>

      {(preset?.baseUrl !== undefined || preset?.id === 'openai-compatible') && (
        <label className="block">
          <span className="text-[11px] text-fg-muted">Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={preset?.baseUrl || 'https://…'}
            className="mt-1 w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
          />
        </label>
      )}

      {preset?.requiresApiKey && (
        <label className="block">
          <span className="text-[11px] text-fg-muted">
            API key{preset.apiKeyUrl ? (
              <> · <a href={preset.apiKeyUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">get one</a></>
            ) : null}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            className="mt-1 w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
          />
        </label>
      )}

      {error && <div className="text-[11px] text-danger">{error}</div>}

      <div className="flex items-center gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-border text-fg-muted hover:text-fg">Cancel</button>
        <button
          onClick={() => void save()}
          disabled={saving || !preset}
          className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save provider'}
        </button>
      </div>
    </div>
  );
}
