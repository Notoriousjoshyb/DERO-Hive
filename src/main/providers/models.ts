import { logger } from '../utils/logger';

// Fetch the live model list from a provider's /models endpoint.
// Falls back to chat-completion probing if /models isn't supported.
export async function fetchLiveModels(
  baseUrl: string,
  apiKey: string,
  presetId?: string,
  customHeaders?: Record<string, string>
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  const base = baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    ...customHeaders
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Anthropic uses a different auth scheme
  if (presetId === 'anthropic' || /anthropic\.com/.test(base)) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    delete headers['Authorization'];
  }

  // 1. Try GET /models
  try {
    const r = await fetch(`${base}/models`, { headers });
    if (r.ok) {
      const data = await r.json();
      const ids = extractModelIds(data);
      if (ids.length > 0) return { ok: true, models: ids };
    }
  } catch (err) {
    logger.debug('models', `/models probe failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Fallback: Anthropic's models endpoint uses ?limit parameter
  if (presetId === 'anthropic' || /anthropic\.com/.test(base)) {
    try {
      const r = await fetch(`${base}/models?limit=100`, { headers });
      if (r.ok) {
        const data = await r.json();
        const ids = extractModelIds(data);
        if (ids.length > 0) return { ok: true, models: ids };
      }
    } catch { /* ignore */ }
  }

  // 3. Some providers (Ollama) use /api/tags
  if (presetId === 'ollama' || /:11434/.test(base)) {
    try {
      const r = await fetch(`${base}/api/tags`, { headers });
      if (r.ok) {
        const data = await r.json();
        const ids = (data.models || []).map((m: { name: string }) => m.name).filter(Boolean);
        if (ids.length > 0) return { ok: true, models: ids };
      }
    } catch { /* ignore */ }
  }

  return { ok: false, error: 'Could not retrieve model list from provider' };
}

function extractModelIds(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  // OpenAI shape: { data: [{id}] }
  if (Array.isArray(d.data)) return d.data.map((m: { id?: string }) => m.id).filter((id): id is string => !!id);
  // Anthropic shape: { data: [{id}] } — same
  // Some gateways: { models: [..] }
  if (Array.isArray(d.models)) return d.models.map((m: unknown) => {
    if (typeof m === 'string') return m;
    if (m && typeof m === 'object') {
      const o = m as Record<string, unknown>;
      return (o.id || o.name) as string;
    }
    return undefined;
  }).filter((s): s is string => !!s);
  return [];
}