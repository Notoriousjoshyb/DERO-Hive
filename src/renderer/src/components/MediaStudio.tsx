import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/app';
import type {
  MediaArtifactRecord,
  MediaGenerationRequest,
  MediaKind,
  MediaModelOption,
  MediaProviderConfig,
  MediaProviderPreset,
  ProviderConfig
} from '@shared/types';

const IMAGE_ASPECTS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'portrait', label: 'Portrait', width: 1024, height: 1792 },
  { id: 'landscape', label: 'Landscape', width: 1792, height: 1024 }
];

interface ProviderOption {
  key: string;
  source: 'model' | 'media';
  id: string;
  name: string;
  models: Array<{ id: string; label: string; hint?: string }>;
  presetId?: string;
  isMinimax?: boolean;
}

function isMinimaxProvider(presetId?: string, baseUrl?: string): boolean {
  return presetId === 'minimax' || /minimax/i.test(baseUrl || '');
}

const MINIMAX_IMAGE_MODELS: Array<{ id: string; label: string; hint?: string }> = [
  { id: 'image-01', label: 'Image-01' }
];

function presetSupportsImage(preset: MediaProviderPreset | undefined): boolean {
  if (!preset) return false;
  if (preset.models.some((m) => m.kind === 'image')) return true;
  return preset.kind === 'image' || preset.kind === 'both';
}

function mediaProviderImageModels(
  provider: MediaProviderConfig,
  preset: MediaProviderPreset | undefined
): MediaModelOption[] {
  if (provider.imageModels && provider.imageModels.length) return provider.imageModels.filter((m) => m.kind === 'image');
  return preset ? preset.models.filter((m) => m.kind === 'image') : [];
}

interface Props {
  variant?: 'panel' | 'tab';
}

export function MediaStudio({ variant = 'panel' }: Props): JSX.Element {
  const currentConversationId = useAppStore((s) => s.currentConversationId);

  const [mediaProviders, setMediaProviders] = useState<MediaProviderConfig[]>([]);
  const [modelProviders, setModelProviders] = useState<ProviderConfig[]>([]);
  const [presets, setPresets] = useState<MediaProviderPreset[]>([]);
  const [artifacts, setArtifacts] = useState<MediaArtifactRecord[]>([]);

  const [prompt, setPrompt] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [aspect, setAspect] = useState('square');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetById = useMemo(() => {
    const m = new Map<string, MediaProviderPreset>();
    for (const p of presets) m.set(p.id, p);
    return m;
  }, [presets]);

  const refresh = useCallback(async (): Promise<void> => {
    const [media, providers] = await Promise.all([window.hive.mediaList(), window.hive.providerList()]);
    setMediaProviders(media.providers);
    setPresets(media.presets);
    setArtifacts(media.artifacts);
    setModelProviders(providers.configured.filter((p) => p.enabled));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return window.hive.onMediaStatus(({ job }) => {
      setArtifacts((prev) => [job, ...prev.filter((a) => a.id !== job.id)]);
    });
  }, []);

  const options = useMemo<ProviderOption[]>(() => {
    const out: ProviderOption[] = [];
    for (const p of modelProviders) {
      const minimax = isMinimaxProvider(p.presetId, p.baseUrl);
      const models = minimax
        ? MINIMAX_IMAGE_MODELS
        : (p.models || []).filter((m) => m.mediaKinds?.includes('image')).map((m) => ({ id: m.id, label: m.name }));
      if (models.length) out.push({ key: `model:${p.id}`, source: 'model', id: p.id, name: p.name, models, presetId: p.presetId, isMinimax: minimax });
    }
    for (const p of mediaProviders) {
      if (!p.enabled) continue;
      const preset = presetById.get(p.presetId);
      if (!presetSupportsImage(preset)) continue;
      const models = mediaProviderImageModels(p, preset).map((m) => ({ id: m.id, label: m.label, hint: m.hint }));
      out.push({ key: `media:${p.id}`, source: 'media', id: p.id, name: p.name, models, presetId: p.presetId });
    }
    return out;
  }, [modelProviders, mediaProviders, presetById]);

  useEffect(() => {
    if (options.length === 0) {
      setSelectedKey('');
      return;
    }
    if (!options.some((o) => o.key === selectedKey)) setSelectedKey(options[0].key);
  }, [options, selectedKey]);

  const selected = options.find((o) => o.key === selectedKey);
  const models = selected?.models ?? [];

  useEffect(() => {
    if (models.length === 0) {
      setModel('');
      return;
    }
    if (!models.some((m) => m.id === model)) setModel(models[0].id);
  }, [models, model]);

  const generate = async (): Promise<void> => {
    if (!prompt.trim() || !selected || generating) return;
    useAppStore.getState().setVisionOpen(true);
    setGenerating(true);
    setError(null);
    const req: MediaGenerationRequest & { conversationId?: string } = {
      prompt: prompt.trim(),
      kind: 'image',
      model: model || undefined,
      conversationId: currentConversationId
    };
    if (selected.source === 'model') req.modelProviderId = selected.id;
    else req.providerId = selected.id;

    const a = IMAGE_ASPECTS.find((x) => x.id === aspect) || IMAGE_ASPECTS[0];
    req.width = a.width;
    req.height = a.height;

    try {
      const res = await window.hive.mediaGenerate(req);
      if (!res.ok) setError(res.error || 'Generation failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
      void refresh();
    }
  };

  const openMediaSettings = (): void => {
    useAppStore.setState({ settingsOpen: true, settingsInitialTab: 'media' });
  };
  const openProviderSettings = (): void => {
    useAppStore.setState({ settingsOpen: true, settingsInitialTab: 'providers' });
  };

  const [enabling, setEnabling] = useState(false);
  const enablePollinations = async (): Promise<void> => {
    setEnabling(true);
    setError(null);
    try {
      const existing = mediaProviders.find((p) => p.presetId === 'pollinations');
      const preset = presets.find((p) => p.id === 'pollinations');
      const cfg: MediaProviderConfig = existing
        ? { ...existing, enabled: true }
        : {
            id: '',
            presetId: 'pollinations',
            name: 'Pollinations',
            baseUrl: preset?.baseUrl || '',
            hasApiKey: false,
            enabled: true,
            defaultImageModel: 'flux',
            updatedAt: Date.now()
          };
      const res = await window.hive.mediaSaveProvider(cfg);
      if (!res.ok) setError(res.error || 'Could not enable Pollinations');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnabling(false);
    }
  };

  const deleteArtifact = async (id: string): Promise<void> => {
    await window.hive.mediaDeleteArtifact(id);
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
  };

  const gridMin = variant === 'tab' ? 260 : 200;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      <div className="border-b border-border p-3 space-y-2.5 flex-shrink-0">
        {options.length === 0 ? (
          <div className="text-xs text-fg-muted bg-bg-elev border border-border rounded-lg p-3 leading-relaxed space-y-2.5">
            <div>
              No image model available.{' '}
              <button onClick={openProviderSettings} className="text-accent hover:underline">Connect a provider</button>
              {' '}with image models, or{' '}
              <button onClick={openMediaSettings} className="text-accent hover:underline">add a media provider</button>.
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void enablePollinations()}
                disabled={enabling}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition"
              >
                {enabling ? 'Enabling…' : 'Enable Pollinations (no key)'}
              </button>
              <span className="text-[11px] text-fg-subtle">Free, key-free image generation. Prompts are sent to pollinations.ai.</span>
            </div>
          </div>
        ) : (
          <>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void generate();
              }}
              placeholder="Describe the image you want to create…"
              rows={variant === 'tab' ? 3 : 2}
              className="w-full resize-none bg-bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="bg-bg-input border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-accent max-w-52"
                title="Provider"
              >
                {options.map((o) => (
                  <option key={o.key} value={o.key}>{o.name}{o.source === 'model' ? '' : ' (media)'}</option>
                ))}
              </select>

              {models.length > 0 && (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-bg-input border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-accent max-w-52"
                  title="Model"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}{m.hint ? ` · ${m.hint}` : ''}</option>
                  ))}
                </select>
              )}

              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                className="bg-bg-input border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-accent"
                title="Aspect ratio"
              >
                {IMAGE_ASPECTS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label} · {a.width}×{a.height}</option>
                ))}
              </select>

              <div className="flex-1" />
              <button
                onClick={() => void generate()}
                disabled={!prompt.trim() || generating}
                className="px-3.5 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {error && <div className="text-xs text-danger">{error}</div>}
          </>
        )}
      </div>

      {artifacts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
          <div className="text-2xl" aria-hidden>🎨</div>
          <div className="text-sm font-medium text-fg">No images yet</div>
          <p className="text-xs text-fg-muted max-w-xs leading-relaxed">
            Generated images appear here.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}px, 1fr))` }}>
            {artifacts.map((a) => (
              <MediaCard key={a.id} artifact={a} onDelete={() => void deleteArtifact(a.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaCard({ artifact, onDelete }: { artifact: MediaArtifactRecord; onDelete: () => void }): JSX.Element {
  const url = window.hive.mediaUrl(artifact.id);
  const pending = artifact.status === 'queued' || artifact.status === 'running';
  const failed = artifact.status === 'failed' || artifact.status === 'cancelled';

  return (
    <div className="bg-bg-elev border border-border rounded-xl overflow-hidden flex flex-col group">
      <div className="relative bg-black/20 flex items-center justify-center min-h-32">
        {pending ? (
          <div className="py-10 flex flex-col items-center gap-2 text-fg-muted">
            <span className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-[11px] capitalize">{artifact.status}…</span>
          </div>
        ) : failed ? (
          <div className="py-8 px-3 text-center text-[11px] text-danger" title={artifact.error}>
            {artifact.status === 'cancelled' ? 'Cancelled' : 'Failed'}
            {artifact.error ? <div className="text-fg-subtle mt-1 line-clamp-3">{artifact.error}</div> : null}
          </div>
        ) : (
          <img src={url} alt={artifact.prompt} className="w-full h-auto object-contain max-h-80" loading="lazy" />
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-1.5">
        <div className="text-[11px] text-fg leading-snug line-clamp-2" title={artifact.prompt}>
          {artifact.prompt}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
          <span className="px-1 py-0.5 rounded bg-accent-soft text-accent uppercase tracking-wide">{artifact.kind}</span>
          <span className="truncate">{artifact.model}</span>
        </div>
        {!pending && !failed && (
          <div className="flex items-center gap-1 pt-0.5">
            <CardAction onClick={() => void window.hive.mediaOpenArtifact(artifact.id)}>Open</CardAction>
            <CardAction onClick={() => void window.hive.mediaRevealArtifact(artifact.id)}>Reveal</CardAction>
            <div className="flex-1" />
            <CardAction danger onClick={onDelete}>Delete</CardAction>
          </div>
        )}
        {(pending || failed) && (
          <div className="flex items-center gap-1 pt-0.5">
            <div className="flex-1" />
            <CardAction danger onClick={onDelete}>Remove</CardAction>
          </div>
        )}
      </div>
    </div>
  );
}

function CardAction({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded transition ${
        danger ? 'text-danger/80 hover:text-danger hover:bg-danger/10' : 'text-fg-muted hover:text-fg hover:bg-bg-input'
      }`}
    >
      {children}
    </button>
  );
}
