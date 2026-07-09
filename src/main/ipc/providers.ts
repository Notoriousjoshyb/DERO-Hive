import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC, type ProviderConfig, type ProviderModel } from '@shared/types';
import { getDb } from '../db/client';
import { setSecret, deleteSecret, getSecret } from '../utils/secrets';
import { clearAdapterCache, listProviders, testConnection, getProviderConfig } from '../providers/registry';
import { PROVIDER_PRESETS, findPreset } from '@shared/presets';
import { logger } from '../utils/logger';
import { fetchLiveModels } from '../providers/models';
import { applyKnownMetadata } from '@shared/modelMetadata';

export function registerProviderHandlers(): void {
  ipcMain.handle(IPC.PROVIDER_LIST, () => {
    const configured = listProviders();
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
      const fallback = (cfg as { defaultModel?: string }).defaultModel || 'default';
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

    // Auto-fetch live models in the background if we have a key
    if (cfg.apiKey) {
      void refreshModelsInBackground(final.id);
    }

    // Strip the plaintext key before returning to renderer
    return { ...final, apiKey: '', hasApiKey: !!cfg.apiKey };
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
    if (!cfg.apiKey) return { ok: false, error: 'API key is required' };
    return await fetchLiveModels(cfg.baseUrl, cfg.apiKey, cfg.presetId, cfg.customHeaders);
  });
}

async function refreshModelsInBackground(id: string): Promise<void> {
  try {
    const r = await refreshModelsNow(id);
    if (r.ok) logger.info('providers', `auto-refreshed ${r.models?.length || 0} models for ${id}`);
    else logger.warn('providers', `auto-refresh failed for ${id}: ${r.error}`);
  } catch (err) {
    logger.warn('providers', `auto-refresh crashed for ${id}`, err);
  }
}

async function refreshModelsNow(id: string): Promise<{ ok: boolean; error?: string; models?: string[]; fetchedAt?: number }> {
  const cfg = getProviderConfig(id);
  if (!cfg) return { ok: false, error: 'Provider not found' };
  // Read the secret directly — the loaded config has apiKey stripped for safety
  const apiKey = getSecret(`provider:${id}`) || '';
  if (!apiKey) return { ok: false, error: 'No API key configured' };

  const live = await fetchLiveModels(cfg.baseUrl, apiKey, cfg.presetId, cfg.customHeaders);
  if (!live.ok) return live;

  // Merge with existing model metadata (context window, capabilities)
  const merged = applyKnownMetadata(mergeModels(cfg.models, live.models || []));
  if (merged.length === 0) {
    return { ok: false, error: 'Provider returned no models' };
  }

  const now = Date.now();
  getDb().prepare('UPDATE providers SET models = ?, models_fetched_at = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(merged), now, now, id);
  clearAdapterCache();

  // Notify renderer to refresh
  const { BrowserWindow } = await import('electron');
  BrowserWindow.getAllWindows().forEach((w) => {
    w.webContents.send(IPC.PROVIDER_MODELS_UPDATED, { id, models: merged, fetchedAt: now });
  });

  return { ok: true, models: merged.map((m) => m.id), fetchedAt: now };
}

function mergeModels(existing: ProviderModel[], live: string[]): ProviderModel[] {
  const map = new Map<string, ProviderModel>();
  // Existing models keep their metadata
  for (const m of existing) map.set(m.id, m);
  // Add any new live IDs (preserve order from provider)
  for (const id of live) {
    if (!map.has(id)) {
      map.set(id, { id, name: id });
    }
  }
  // Output: live order first, then any existing-only models
  const out: ProviderModel[] = [];
  for (const id of live) {
    const m = map.get(id);
    if (m) out.push(m);
  }
  for (const [id, m] of map) {
    if (!live.includes(id)) out.push(m);
  }
  return out;
}