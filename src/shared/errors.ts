// Structured error classification for providers, tools, and the harness
// itself. Pure and dependency-free so it can be imported from main, preload,
// renderer, and the CLI alike.

import type { HiveErrorInfo } from './types';

export interface ProviderErrorInput {
  status?: number;
  code?: string;
  message?: string;
  providerId?: string;
  model?: string;
}

/** Sniff a retry delay out of provider messages / Retry-After style text.
 *  Values are expressed in seconds by providers; returns milliseconds. */
function parseRetryAfterMs(message: string): number | undefined {
  const match = /retry[- ]?after[:\s]*(\d+(?:\.\d+)?)/i.exec(message)
    || /try again in\s*(\d+(?:\.\d+)?)\s*s/i.exec(message);
  if (!match) return undefined;
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

/** Classify a provider failure into the shared taxonomy. Status codes win
 *  first; message/code sniffing covers adapters that only surface text. */
export function classifyProviderError(input: ProviderErrorInput): HiveErrorInfo {
  const status = typeof input.status === 'number' ? input.status : undefined;
  const message = input.message || '';
  const text = `${input.code || ''} ${message}`.toLowerCase();
  const base = { category: 'provider' as const, providerId: input.providerId, model: input.model };

  if (status === 429 || /rate.?limit|too many requests/.test(text)) {
    return {
      ...base,
      kind: 'rate_limit',
      retriable: true,
      retryAfterMs: parseRetryAfterMs(message),
      message: message || 'Rate limited'
    };
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key|authentication/.test(text)) {
    return { ...base, kind: 'auth', retriable: false, message: message || 'Authentication failed' };
  }
  if (status === 402 || /quota|billing|insufficient/.test(text)) {
    return { ...base, kind: 'quota', retriable: false, message: message || 'Quota or billing limit reached' };
  }
  if (status === 529 || status === 503 || status === 502 || /overloaded|service unavailable|bad gateway/.test(text)) {
    return { ...base, kind: 'overloaded', retriable: true, message: message || 'Provider overloaded' };
  }
  if (/\beconnreset\b|\betimedout\b|\benotfound\b|\beconnrefused\b|fetch failed|network/.test(text)) {
    return { ...base, kind: 'network', retriable: true, message: message || 'Network error' };
  }
  if (status === 400 || status === 404 || status === 422 || /invalid|not found|bad request/.test(text)) {
    return { ...base, kind: 'invalid_request', retriable: false, message: message || 'Invalid request' };
  }
  return { ...base, kind: 'unknown', retriable: false, message: message || 'Unknown provider error' };
}

/** Classify an arbitrary thrown value. Pulls `status`/`code` off Error-like
 *  objects (fetch adapters commonly attach them); `ctx` wins when provided. */
export function toHiveError(error: unknown, ctx: Omit<ProviderErrorInput, 'message'> = {}): HiveErrorInfo {
  if (error instanceof Error) {
    const err = error as Error & { status?: unknown; code?: unknown };
    return classifyProviderError({
      status: ctx.status ?? (typeof err.status === 'number' ? err.status : undefined),
      code: ctx.code ?? (typeof err.code === 'string' ? err.code : undefined),
      message: error.message,
      providerId: ctx.providerId,
      model: ctx.model
    });
  }
  return classifyProviderError({
    status: ctx.status,
    code: ctx.code,
    message: typeof error === 'string' ? error : String(error),
    providerId: ctx.providerId,
    model: ctx.model
  });
}
