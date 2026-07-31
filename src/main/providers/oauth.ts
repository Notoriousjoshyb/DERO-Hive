import type { OAuthStatus } from '@shared/types';
import { getSecret, setSecret, deleteSecret } from '../utils/secrets';
import { logger } from '../utils/logger';

// This module is shared with the CLI build, where electron is not installed —
// resolve shell.openExternal lazily (same pattern as utils/secrets.ts). In the
// CLI the browser is simply not auto-opened; the verification URL is still
// returned for the caller to print.
function openExternal(url: string): void {
  if (!process.versions.electron) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    void electron.shell.openExternal(url).catch((err) => {
      logger.warn('oauth', `could not open browser: ${String(err)}`);
    });
  } catch {
    // electron unavailable — caller shows the URL instead
  }
}

// Browser sign-in via the OAuth 2.0 Device Authorization Grant (RFC 8628).
//
// Only presets whose vendor sanctions third-party coding clients are listed
// here. Kimi's device flow is the same one Moonshot ships in its own OSS
// kimi-cli / kimi-code, and their coding endpoint is deliberately open to
// third-party agents. Anthropic and Google, by contrast, prohibit using their
// first-party OAuth clients outside their own apps (both added server-side
// enforcement in early 2026), so those presets stay API-key only.
export interface OAuthDeviceFlowConfig {
  host: string;
  clientId: string;
}

export const OAUTH_FLOWS: Record<string, OAuthDeviceFlowConfig> = {
  kimi: {
    host: 'https://auth.kimi.com',
    clientId: '17e5f671-d194-4dfb-9706-5516cb48c098'
  }
};

// Persisted (encrypted) alongside the tokens so refresh works without needing
// the preset to be re-resolved.
interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when accessToken expires; absent = treat as non-expiring. */
  expiresAt?: number;
  host: string;
  clientId: string;
}

interface PendingFlow {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  cancelled: boolean;
}

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_S = 5;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const pendingFlows = new Map<string, PendingFlow>();
const lastErrors = new Map<string, string>();
const refreshInFlight = new Map<string, Promise<string | undefined>>();

// Set by ipc/providers.ts so a completed sign-in immediately refreshes the
// provider's model list (no circular import).
let onSignedIn: ((providerId: string) => void) | undefined;
export function setOAuthSignedInListener(cb: (providerId: string) => void): void {
  onSignedIn = cb;
}

function secretKey(providerId: string): string {
  return `oauth:${providerId}`;
}

function loadTokens(providerId: string): StoredTokens | undefined {
  const raw = getSecret(secretKey(providerId));
  if (!raw) return undefined;
  try {
    const t = JSON.parse(raw) as StoredTokens;
    return t.accessToken && t.host && t.clientId ? t : undefined;
  } catch {
    return undefined;
  }
}

function saveTokens(providerId: string, tokens: StoredTokens): void {
  setSecret(secretKey(providerId), JSON.stringify(tokens));
}

export function hasOAuthTokens(providerId: string): boolean {
  return !!loadTokens(providerId);
}

export function oauthFlowForPreset(presetId?: string): OAuthDeviceFlowConfig | undefined {
  return presetId ? OAUTH_FLOWS[presetId] : undefined;
}

async function postForm(url: string, params: Record<string, string>): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await r.json()) as Record<string, unknown>;
  } catch { /* non-JSON error body */ }
  return { status: r.status, data };
}

function tokensFromResponse(data: Record<string, unknown>, flow: OAuthDeviceFlowConfig, previous?: StoredTokens): StoredTokens | null {
  const accessToken = data.access_token;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  const refreshToken = typeof data.refresh_token === 'string' && data.refresh_token
    ? data.refresh_token
    // Some servers omit refresh_token on refresh responses; keep the old one.
    : previous?.refreshToken;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    host: flow.host,
    clientId: flow.clientId
  };
}

/**
 * Begin a device-flow sign-in for a provider. Opens the verification page in
 * the default browser and polls for completion in the background. Returns the
 * pending state (user code + URL) for the UI to display.
 */
export async function startDeviceFlow(providerId: string, presetId?: string): Promise<OAuthStatus> {
  const flow = oauthFlowForPreset(presetId);
  if (!flow) return { state: 'error', error: `Browser sign-in is not available for this provider (preset: ${presetId || 'none'}).` };

  // Restarting supersedes any previous pending attempt.
  const existing = pendingFlows.get(providerId);
  if (existing) existing.cancelled = true;
  lastErrors.delete(providerId);

  let status: number;
  let data: Record<string, unknown>;
  try {
    ({ status, data } = await postForm(`${flow.host}/api/oauth/device_authorization`, { client_id: flow.clientId }));
  } catch (err) {
    const error = `Could not reach ${flow.host}: ${err instanceof Error ? err.message : String(err)}`;
    lastErrors.set(providerId, error);
    return { state: 'error', error };
  }

  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUriComplete = data.verification_uri_complete;
  if (status !== 200 || typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUriComplete !== 'string') {
    const error = `Device authorization failed (HTTP ${status}): ${JSON.stringify(data).slice(0, 200)}`;
    lastErrors.set(providerId, error);
    return { state: 'error', error };
  }

  const verificationUri = typeof data.verification_uri === 'string' ? data.verification_uri : verificationUriComplete;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 300;
  const intervalS = typeof data.interval === 'number' && data.interval > 0 ? data.interval : DEFAULT_POLL_INTERVAL_S;
  const expiresAt = Date.now() + expiresIn * 1000;

  const pending: PendingFlow = { userCode, verificationUri, expiresAt, cancelled: false };
  pendingFlows.set(providerId, pending);

  openExternal(verificationUriComplete);

  void pollForTokens(providerId, deviceCode, flow, pending, intervalS);

  logger.info('oauth', `device flow started for ${providerId} (code ${userCode})`);
  return { state: 'pending', userCode, verificationUri, expiresAt };
}

async function pollForTokens(
  providerId: string,
  deviceCode: string,
  flow: OAuthDeviceFlowConfig,
  pending: PendingFlow,
  intervalS: number
): Promise<void> {
  let waitS = intervalS;
  while (!pending.cancelled && Date.now() < pending.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, waitS * 1000));
    if (pending.cancelled) return;
    try {
      const { status, data } = await postForm(`${flow.host}/api/oauth/token`, {
        client_id: flow.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      });
      const tokens = status === 200 ? tokensFromResponse(data, flow) : null;
      if (tokens) {
        saveTokens(providerId, tokens);
        finishPending(providerId, pending);
        logger.info('oauth', `signed in for ${providerId}`);
        onSignedIn?.(providerId);
        return;
      }
      const errorCode = typeof data.error === 'string' ? data.error : '';
      if (errorCode === 'authorization_pending') continue;
      if (errorCode === 'slow_down') { waitS += 5; continue; }
      if (errorCode === 'expired_token') {
        failPending(providerId, pending, 'The sign-in code expired before it was confirmed. Try again.');
        return;
      }
      if (errorCode === 'access_denied') {
        failPending(providerId, pending, 'Sign-in was denied in the browser.');
        return;
      }
      // Transient server trouble — keep polling until the code expires.
      if (RETRYABLE_STATUSES.has(status)) continue;
      failPending(providerId, pending, `Sign-in failed (HTTP ${status}): ${JSON.stringify(data).slice(0, 200)}`);
      return;
    } catch (err) {
      // Network blip — keep polling.
      logger.debug('oauth', `poll error for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!pending.cancelled) {
    failPending(providerId, pending, 'The sign-in code expired before it was confirmed. Try again.');
  }
}

function finishPending(providerId: string, pending: PendingFlow): void {
  pending.cancelled = true;
  if (pendingFlows.get(providerId) === pending) pendingFlows.delete(providerId);
  lastErrors.delete(providerId);
}

function failPending(providerId: string, pending: PendingFlow, error: string): void {
  pending.cancelled = true;
  if (pendingFlows.get(providerId) === pending) pendingFlows.delete(providerId);
  lastErrors.set(providerId, error);
  logger.warn('oauth', `sign-in failed for ${providerId}: ${error}`);
}

export function getOAuthStatus(providerId: string): OAuthStatus {
  const pending = pendingFlows.get(providerId);
  if (pending && !pending.cancelled && Date.now() < pending.expiresAt) {
    return { state: 'pending', userCode: pending.userCode, verificationUri: pending.verificationUri, expiresAt: pending.expiresAt };
  }
  const tokens = loadTokens(providerId);
  if (tokens) return { state: 'signed-in', expiresAt: tokens.expiresAt };
  const error = lastErrors.get(providerId);
  if (error) return { state: 'error', error };
  return { state: 'none' };
}

export function signOut(providerId: string): void {
  const pending = pendingFlows.get(providerId);
  if (pending) pending.cancelled = true;
  pendingFlows.delete(providerId);
  lastErrors.delete(providerId);
  deleteSecret(secretKey(providerId));
  logger.info('oauth', `signed out ${providerId}`);
}

/**
 * Return a valid access token for the provider, refreshing when the current
 * one is inside the expiry threshold. Returns undefined when the provider has
 * no OAuth session (callers fall back to the API key).
 */
export async function getOAuthAccessToken(providerId: string): Promise<string | undefined> {
  const tokens = loadTokens(providerId);
  if (!tokens) return undefined;
  const fresh = !tokens.expiresAt || Date.now() < tokens.expiresAt - REFRESH_THRESHOLD_MS;
  if (fresh) return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken; // nothing to refresh with — let the API report expiry

  const inFlight = refreshInFlight.get(providerId);
  if (inFlight) return inFlight;
  const p = refreshTokens(providerId, tokens).finally(() => refreshInFlight.delete(providerId));
  refreshInFlight.set(providerId, p);
  return p;
}

async function refreshTokens(providerId: string, tokens: StoredTokens): Promise<string | undefined> {
  const flow: OAuthDeviceFlowConfig = { host: tokens.host, clientId: tokens.clientId };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status, data } = await postForm(`${flow.host}/api/oauth/token`, {
        client_id: flow.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken!
      });
      const next = status === 200 ? tokensFromResponse(data, flow, tokens) : null;
      if (next) {
        saveTokens(providerId, next);
        logger.info('oauth', `refreshed access token for ${providerId}`);
        return next.accessToken;
      }
      const errorCode = typeof data.error === 'string' ? data.error : '';
      if (status === 401 || status === 403 || errorCode === 'invalid_grant') {
        // Session revoked — clear it so the UI offers sign-in again instead of
        // every request failing with an opaque 401.
        deleteSecret(secretKey(providerId));
        lastErrors.set(providerId, 'Your session expired or was revoked. Sign in again.');
        logger.warn('oauth', `refresh rejected for ${providerId}; session cleared`);
        return undefined;
      }
      if (!RETRYABLE_STATUSES.has(status)) {
        logger.warn('oauth', `refresh failed for ${providerId} (HTTP ${status})`);
        return tokens.accessToken; // possibly still valid; let the API decide
      }
    } catch (err) {
      logger.debug('oauth', `refresh attempt ${attempt + 1} errored for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  return tokens.accessToken;
}
