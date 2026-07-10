import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../src/main/db/client', () => ({
  getDb: () => ({ prepare: () => ({ all: () => [] }) }),
  getSetting: () => null,
  setSetting: () => undefined
}));
vi.mock('../src/main/ipc/chat', () => ({ onChatStreamEvent: () => () => undefined }));

const { allowedExtensionOrigin, clientTokenMatches, hashClientToken, isAllowedBridgeHost } =
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
});
