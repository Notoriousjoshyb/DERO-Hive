import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type ProviderConfig, type ProviderModel } from '@shared/types';
import { getDb } from '../db/client';
import { setSecret, deleteSecret, getSecret } from '../utils/secrets';
import { clearAdapterCache, listProviders, testConnection, getProviderConfig, getAdapter } from '../providers/registry';
import { PROVIDER_PRESETS, findPreset } from '@shared/presets';
import { logger } from '../utils/logger';
import { fetchLiveModels } from '../providers/models';
import { applyKnownMetadata } from '@shared/modelMetadata';

// Keep model lists fresh: refresh on startup, on a timer, and opportunistically
// whenever the renderer asks for the provider list and the cached models are stale.
const MODEL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MODEL_STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
const refreshInFlight = new Set<string>();

export function startModelRefreshScheduler(): void {
  void refreshAllProviderModels();
  setInterval(() => void refreshAllProviderModels(), MODEL_REFRESH_INTERVAL_MS);
}

async function refreshAllProviderModels(): Promise<void> {
  const configured = listProviders().filter((p) => p.enabled && p.baseUrl);
  await Promise.allSettled(configured.map((p) => refreshModelsInBackground(p.id)));
}

export function registerProviderHandlers(): void {
  ipcMain.handle(IPC.PROVIDER_LIST, () => {
    const configured = listProviders();
    // Top up any stale model lists in the background; the renderer listens for
    // PROVIDER_MODELS_UPDATED and reloads when each refresh lands.
    const now = Date.now();
    for (const p of configured) {
      if (p.enabled && p.baseUrl && (!p.modelsFetchedAt || now - p.modelsFetchedAt > MODEL_STALE_AFTER_MS)) {
        void refreshModelsInBackground(p.id);
      }
    }
    return {
      configured,
      presets: PROVIDER_PRESETS
    };
  });

  ipcMain.handle(IPC.PROVIDER_SAVE, async (_e, cfg: ProviderConfig & { apiKey?: string }) => {
    const id = cfg.id || `provider-${randomUUID().slice(0, 8)}`;
    const final: ProviderConfig = { ...cfg, id };

    // If a preset is referenced and no models supplied, use preset models
    if (final.presetId && (!final.models || final.models.length === 0)) {
      const preset = findPreset(final.presetId);
      if (preset) {
        final.models = preset.models;
        if (!final.baseUrl) final.baseUrl = preset.baseUrl;
      }
    }
    if (!final.models || final.models.length === 0) {
      const preset = final.presetId ? findPreset(final.presetId) : undefined;
      const fallback = preset?.defaultModel || 'default';
      final.models = [{ id: fallback, name: fallback }];
    }

    // Apply known metadata (context window, capabilities) to all models before saving
    final.models = applyKnownMetadata(final.models);

    if (cfg.apiKey) setSecret(`provider:${final.id}`, cfg.apiKey);

    getDb().prepare(`
      INSERT INTO providers (id, preset_id, name, base_url, api_key_ref, enabled, models, custom_headers, models_fetched_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        preset_id = excluded.preset_id,
        name = excluded.name,
        base_url = excluded.base_url,
        api_key_ref = excluded.api_key_ref,
        enabled = excluded.enabled,
        models = excluded.models,
        custom_headers = excluded.custom_headers,
        updated_at = excluded.updated_at
    `).run(
      final.id, final.presetId || null, final.name, final.baseUrl,
      cfg.apiKey ? `provider:${final.id}` : null,
      final.enabled ? 1 : 0,
      JSON.stringify(final.models),
      JSON.stringify(final.customHeaders || {}),
      null, Date.now()
    );

    clearAdapterCache();
    logger.info('providers', `saved ${final.name}`);

    // Saving Codex is an explicit user action, so immediately start its
    // ChatGPT OAuth-backed discovery. Startup/list refreshes still skip it to
    // avoid opening a browser unexpectedly later.
    if (final.presetId === 'codex') {
      void refreshModelsNow(final.id).then((result) => {
        if (!result.ok) logger.warn('providers', `Codex model discovery failed for ${final.id}: ${result.error}`);
      });
    } else {
      // Auto-fetch live models in the background so the list is current.
      void refreshModelsInBackground(final.id);
    }

    // Strip the plaintext key before returning to renderer
    return { ...final, apiKey: '', hasApiKey: !!cfg.apiKey || !!getSecret(`provider:${final.id}`) };
  });

  ipcMain.handle(IPC.PROVIDER_DELETE, async (_e, id: string) => {
    getDb().prepare('DELETE FROM providers WHERE id = ?').run(id);
    deleteSecret(`provider:${id}`);
    clearAdapterCache();
    return { ok: true };
  });

  ipcMain.handle(IPC.PROVIDER_TEST, async (_e, id: string) => {
    return testConnection(id);
  });

  ipcMain.handle(IPC.PROVIDER_MODELS, async (_e, id: string) => {
    return testConnection(id);
  });

  ipcMain.handle(IPC.PROVIDER_REFRESH_MODELS, async (_e, id: string) => {
    return refreshModelsNow(id);
  });

  ipcMain.handle(IPC.PROVIDER_PROBE_MODELS, async (_e, cfg: { baseUrl: string; apiKey: string; presetId?: string; customHeaders?: Record<string, string> }) => {
    if (!cfg.baseUrl) return { ok: false, error: 'Base URL is required' };
    return await fetchLiveModels(cfg.baseUrl, cfg.apiKey, cfg.presetId, cfg.customHeaders);
  });
}

async function refreshModelsInBackground(id: string): Promise<void> {
  if (refreshInFlight.has(id)) return;
  const cfg = getProviderConfig(id);
  // Codex requires interactive browser login; don't auto-refresh it silently.
  if (cfg?.presetId === 'codex') return;
  refreshInFlight.add(id);
  try {
    const r = await refreshModelsNow(id);
    if (r.ok) logger.info('providers', `auto-refreshed ${r.models?.length || 0} models for ${id}`);
    else logger.warn('providers', `auto-refresh failed for ${id}: ${r.error}`);
  } catch (err) {
    logger.warn('providers', `auto-refresh crashed for ${id}`, err);
  } finally {
    refreshInFlight.delete(id);
  }
}

async function refreshModelsNow(id: string): Promise<{ ok: boolean; error?: string; models?: string[]; fetchedAt?: number }> {
  const cfg = getProviderConfig(id);
  if (!cfg) return { ok: false, error: 'Provider not found' };

  // Codex (ACP) discovers models through its own adapter, not an OpenAI /models endpoint.
  if (cfg.presetId === 'codex') {
    const adapter = getAdapter(id);
    if (!adapter) return { ok: false, error: 'Codex provider not enabled' };
    const r = await adapter.testConnection();
    if (!r.ok || !r.models) return { ok: false, error: r.error || 'No models found' };
    return updateProviderModels(id, r.models, cfg, r.modelDetails);
  }

  // Read the secret directly — the loaded config has apiKey stripped for safety
  const apiKey = getSecret(`provider:${id}`) || '';

  const live = await fetchLiveModels(cfg.baseUrl, apiKey, cfg.presetId, cfg.customHeaders);
  if (!live.ok) return live;
  if (!live.models || live.models.length === 0) {
    return { ok: false, error: 'Provider returned no models' };
  }
  return updateProviderModels(id, live.models, cfg, live.details);
}

async function updateProviderModels(
  id: string,
  modelIds: string[],
  cfg: ProviderConfig,
  details?: Record<string, Partial<ProviderModel>>
): Promise<{ ok: boolean; error?: string; models?: string[]; fetchedAt?: number }> {
  if (modelIds.length === 0) {
    return { ok: false, error: 'Provider returned no models' };
  }

  // Use live list as the source of truth and rebuild metadata each refresh:
  // what the provider reports live wins, then applyKnownMetadata fills the
  // gaps from our table. Deliberately NOT carrying stored metadata forward —
  // it only ever came from these same sources and would pin stale values.
  const liveModels: ProviderModel[] = modelIds.map((modelId) => {
    const existing = cfg.models.find((m) => m.id === modelId);
    const detail = details?.[modelId];
    return {
      id: modelId,
      name: detail?.name || existing?.name || modelId,
      contextWindow: detail?.contextWindow,
      maxOutput: detail?.maxOutput,
      supportsVision: detail?.supportsVision,
      supportsTools: detail?.supportsTools,
      supportsReasoning: detail?.supportsReasoning,
      thinkingOptions: detail?.thinkingOptions
    };
  });
  const merged = applyKnownMetadata(liveModels);

  const now = Date.now();
  getDb().prepare('UPDATE providers SET models = ?, models_fetched_at = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(merged), now, now, id);

  // Notify renderer to refresh
  const { BrowserWindow } = await import('electron');
  BrowserWindow.getAllWindows().forEach((w) => {
    w.webContents.send(IPC.PROVIDER_MODELS_UPDATED, { id, models: merged, fetchedAt: now });
  });

  return { ok: true, models: merged.map((m) => m.id), fetchedAt: now };
}
