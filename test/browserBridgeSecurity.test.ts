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

describe('Browser Companion bridge security', () => {
  test('accepts only its loopback host, Chrome extension origins, and hashed tokens', () => {
    const origin = `chrome-extension://${'a'.repeat(32)}`;
    const hash = hashClientToken('client-token');

    expect(isAllowedBridgeHost('127.0.0.1:43120')).toBe(true);
    expect(isAllowedBridgeHost('localhost:43120')).toBe(false);
    expect(allowedExtensionOrigin(origin)).toBe(origin);
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
});
