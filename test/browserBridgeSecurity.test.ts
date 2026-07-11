import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const persisted = vi.hoisted(() => ({ key: '', value: undefined as unknown }));

vi.mock('../src/main/db/client', () => ({
  getDb: () => ({ prepare: () => ({ all: () => [] }) }),
  getSetting: () => null,
  setSetting: (key: string, value: unknown) => { persisted.key = key; persisted.value = value; }
}));
vi.mock('../src/main/ipc/chat', () => ({ onChatStreamEvent: () => () => undefined }));

const { BrowserBridge, allowedExtensionOrigin, clientTokenMatches, hashClientToken, isAllowedBridgeHost } =
  await import('../src/main/browserBridge');

const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;

async function pairBridge(bridge: InstanceType<typeof BrowserBridge>): Promise<string> {
  const status = await bridge.setEnabled(true);
  const pair = await fetch('http://127.0.0.1:43120/v1/pair', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ code: status.pairingCode })
  });
  const { token } = await pair.json() as { token: string };
  expect(pair.status).toBe(200);
  return token;
}

describe('Browser Companion bridge security', () => {
  test('accepts only its loopback host, Chrome extension origins, and hashed tokens', () => {
    const hash = hashClientToken('client-token');

    expect(isAllowedBridgeHost('127.0.0.1:43120')).toBe(true);
    expect(isAllowedBridgeHost('localhost:43120')).toBe(false);
    expect(allowedExtensionOrigin(ORIGIN)).toBe(ORIGIN);
    expect(allowedExtensionOrigin('https://example.com')).toBeNull();
    expect(clientTokenMatches('client-token', hash)).toBe(true);
    expect(clientTokenMatches('wrong-token', hash)).toBe(false);
  });

  test('does not expose pairing or stream credentials through GET URLs or wildcard CORS', () => {
    const bridge = readFileSync(resolve('src/main/browserBridge.ts'), 'utf8');
    const panel = readFileSync(resolve('browser-extension/sidepanel.js'), 'utf8');

    expect(bridge).not.toContain("request.method === 'GET' && url.pathname === '/v1/pair'");
    expect(bridge).not.toContain("Access-Control-Allow-Origin', '*'");
    expect(panel).not.toContain('EventSource(');
    expect(panel).not.toMatch(/[?&]token=/);
  });

  test('extension host access is limited to the local bridge', () => {
    const manifest = JSON.parse(readFileSync(resolve('browser-extension/manifest.json'), 'utf8')) as {
      permissions: string[];
      host_permissions: string[];
    };
    const panel = readFileSync(resolve('browser-extension/sidepanel.js'), 'utf8');

    expect(manifest.host_permissions).toEqual(['http://127.0.0.1:43120/*']);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['activeTab', 'scripting']));
    expect(panel).toContain('chrome.scripting.executeScript');
  });

  test('revoking pairing clears the persisted credential', () => {
    const bridge = new BrowserBridge(() => null);

    const status = bridge.revokePairing();

    expect(status.paired).toBe(false);
    expect(status.enabled).toBe(false);
    expect(persisted).toEqual({ key: 'browserBridgePairing', value: null });
    bridge.dispose();
  });

  test('accepts an origin-less authenticated extension GET after strict origin pairing', async () => {
    const bridge = new BrowserBridge(() => null);
    try {
      const token = await pairBridge(bridge);

      const health = await fetch('http://127.0.0.1:43120/health', {
        headers: { Authorization: `Bearer ${token}`, Connection: 'close' }
      });
      expect(health.status).toBe(200);

      const hostileOrigin = await fetch('http://127.0.0.1:43120/health', {
        headers: { Origin: 'https://example.com', Authorization: `Bearer ${token}`, Connection: 'close' }
      });
      expect(hostileOrigin.status).toBe(403);
    } finally {
      await bridge.stop();
      bridge.dispose();
    }
  });

  test('binds authenticated captures to the active Hive project and enforces automated-write consent', async () => {
    const capture = vi.fn(async () => ({ path: 'Inbox/Raw/browser.md', queued: false }));
    const bridge = new BrowserBridge(() => null, () => null, () => ({ capture }) as never);
    bridge.reportSelection('provider', 'model', { id: 'project-1', name: 'DERO Lab' });
    try {
      const token = await pairBridge(bridge);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close' };

      const switched = await fetch('http://127.0.0.1:43120/v1/select-model', {
        method: 'POST', headers, body: JSON.stringify({ providerId: 'other-provider', model: 'other-model' })
      });
      expect(switched.status).toBe(200);
      const stateResponse = await fetch('http://127.0.0.1:43120/v1/state', { headers });
      const state = await stateResponse.json() as { activeProject: unknown };
      expect(state.activeProject).toEqual({ id: 'project-1', name: 'DERO Lab' });

      const unauthenticated = await fetch('http://127.0.0.1:43120/v1/capture', {
        method: 'POST'
      });
      expect(unauthenticated.status).toBe(401);
      expect(capture).not.toHaveBeenCalled();

      const saved = await fetch('http://127.0.0.1:43120/v1/capture', {
        method: 'POST', headers, body: JSON.stringify({ projectId: 'attacker-project', title: 'Page title', url: 'https://example.com/page', content: 'Page evidence' })
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ queued: false, path: 'Inbox/Raw/browser.md' });
      expect(capture).toHaveBeenCalledWith(
        { projectId: 'project-1', title: 'Page title', content: 'Page evidence', source: 'https://example.com/page' },
        { automated: true }
      );

      capture.mockRejectedValueOnce(new Error('Automated knowledge writes are disabled for this project'));
      const denied = await fetch('http://127.0.0.1:43120/v1/capture', {
        method: 'POST', headers, body: JSON.stringify({ content: 'Page evidence' })
      });
      expect(denied.status).toBe(403);

      bridge.clearActiveProject();
      const clearedStateResponse = await fetch('http://127.0.0.1:43120/v1/state', { headers });
      expect(await clearedStateResponse.json()).toMatchObject({
        providerId: 'other-provider', model: 'other-model', activeProject: null
      });
      const unscoped = await fetch('http://127.0.0.1:43120/v1/capture', {
        method: 'POST', headers, body: JSON.stringify({ projectId: 'attacker-project', content: 'Page evidence' })
      });
      expect(unscoped.status).toBe(409);
    } finally {
      await bridge.stop();
      bridge.dispose();
    }
  });
});
