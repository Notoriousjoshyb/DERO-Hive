import { getSetting } from '../db/client';
import { getSecret } from '../utils/secrets';
import type { WebSearchProvider, WebSearchSettings } from '@shared/types';

/**
 * web_search behind a provider seam.
 *
 * The rule that shapes this file: **no provider configured means the tool is
 * absent**, never a runtime error telling the model to go and buy an API key.
 * A tool the model can see is a tool it will spend a turn calling.
 *
 * Three providers, because they cover the three ways people actually have
 * search: a key they pay for (Brave), a key aimed at agents (Tavily), and a
 * SearXNG instance they run themselves (no key, often on loopback).
 *
 * See REMAINING_WORK.md §3.2.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ResolvedSearchConfig {
  provider: WebSearchProvider;
  apiKey: string;
  endpoint: string;
}

/** Where a provider's key lives in the secret store. */
export function searchSecretKey(provider: WebSearchProvider): string {
  return `websearch:${provider}`;
}

/**
 * The configured provider, or null when search is not usable. Anything that
 * cannot answer a query — no key, no endpoint — reads as null here rather than
 * failing later.
 */
export function resolveSearchConfig(): ResolvedSearchConfig | null {
  let settings: WebSearchSettings | undefined;
  try {
    settings = (getSetting<{ webSearch?: WebSearchSettings }>('appSettings') || {}).webSearch;
  } catch {
    return null; // no database yet (tests, early boot)
  }
  const provider = settings?.provider;
  if (!provider || provider === 'none') return null;

  if (provider === 'searxng') {
    const endpoint = (settings?.endpoint || '').trim().replace(/\/+$/, '');
    // A self-hosted instance is usually on loopback, so this endpoint is
    // deliberately exempt from the web_fetch address guard: it is user
    // configuration, not a URL the model chose.
    if (!endpoint) return null;
    return { provider, apiKey: '', endpoint };
  }

  let apiKey: string;
  try { apiKey = getSecret(searchSecretKey(provider)) || ''; } catch { apiKey = ''; }
  if (!apiKey) return null;
  return { provider, apiKey, endpoint: '' };
}

export function webSearchAvailable(): boolean {
  return resolveSearchConfig() !== null;
}

const TIMEOUT_MS = 15_000;
const MAX_RESULTS = 20;

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  const config = resolveSearchConfig();
  if (!config) throw new Error('No search provider is configured.');
  const n = Math.max(1, Math.min(MAX_RESULTS, count));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (config.provider === 'brave') return await braveSearch(query, n, config.apiKey, controller.signal);
    if (config.provider === 'tavily') return await tavilySearch(query, n, config.apiKey, controller.signal);
    return await searxngSearch(query, n, config.endpoint, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function braveSearch(query: string, count: number, apiKey: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  const res = await fetch(url, {
    signal,
    headers: { accept: 'application/json', 'x-subscription-token': apiKey }
  });
  if (!res.ok) throw new Error(`Brave search failed: HTTP ${res.status}`);
  const body = await res.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return normalize(body.web?.results, (r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function tavilySearch(query: string, count: number, apiKey: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: count, search_depth: 'basic' })
  });
  if (!res.ok) throw new Error(`Tavily search failed: HTTP ${res.status}`);
  const body = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return normalize(body.results, (r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function searxngSearch(query: string, count: number, endpoint: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL(`${endpoint}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    // A stock SearXNG ships with the JSON API disabled; say so, because the
    // fix is one line of its settings.yml and not obvious from a 403.
    if (res.status === 403) throw new Error('SearXNG refused the request: enable the "json" format in its settings.yml.');
    throw new Error(`SearXNG search failed: HTTP ${res.status}`);
  }
  const body = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return normalize(body.results, (r) => ({ title: r.title, url: r.url, snippet: r.content })).slice(0, count);
}

/** Shared shape-checking: a provider answering with junk yields no results, not a crash. */
function normalize<T>(raw: T[] | undefined, pick: (r: T) => { title?: string; url?: string; snippet?: string }): SearchResult[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchResult[] = [];
  for (const item of raw) {
    const { title, url, snippet } = pick(item);
    if (typeof url !== 'string' || !url) continue;
    out.push({
      title: typeof title === 'string' && title ? title : url,
      url,
      snippet: typeof snippet === 'string' ? snippet.replace(/\s+/g, ' ').trim() : ''
    });
  }
  return out;
}

/** Render results for the model: numbered, with the URL on its own line to copy into web_fetch. */
export function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `No results for "${query}".`;
  return [
    `${results.length} result(s) for "${query}":`,
    ...results.map((r, i) => {
      // Collapsed here as well as in normalize(): a stray newline in a snippet
      // would look like a new result to the model reading this list.
      const snippet = r.snippet.replace(/\s+/g, ' ').trim();
      return `\n${i + 1}. ${r.title || r.url}\n   ${r.url}${snippet ? `\n   ${snippet}` : ''}`;
    })
  ].join('\n');
}
