import { beforeEach, describe, expect, test, vi } from 'vitest';

let row: Record<string, unknown> | undefined;
const secrets = new Map<string, string>();

vi.mock('../src/main/db/client', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => row,
      all: () => row ? [row] : [],
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO mcp_servers')) {
          const [id, name, enabled, transport, command, url, argJson, envJson, cwd, timeout, trust, updated] = args;
          row = {
            id, name, enabled, transport, command, url, args: argJson, env: envJson,
            cwd, timeout_ms: timeout, trust, updated_at: updated
          };
        } else if (sql.includes('UPDATE mcp_servers SET env')) {
          if (row) row.env = args[0];
        }
      }
    })
  })
}));

vi.mock('../src/main/utils/secrets', () => ({
  setSecret: (key: string, value: string) => secrets.set(key, value),
  getSecret: (key: string) => secrets.get(key),
  deleteSecret: (key: string) => secrets.delete(key)
}));

const { McpManager, validateMcpConfig } = await import('../src/main/mcp/manager');

beforeEach(() => {
  row = undefined;
  secrets.clear();
});

describe('MCP config validation', () => {
  test('accepts legacy stdio configs and rejects unsafe HTTP URLs', () => {
    expect(() => validateMcpConfig({ id: 'x', name: 'x', enabled: false, command: 'npx' })).not.toThrow();
    expect(() => validateMcpConfig({
      id: 'x', name: 'x', enabled: false, transport: 'http', url: 'file:///vault'
    })).toThrow(/http or https/);
    expect(() => validateMcpConfig({
      id: 'x', name: 'x', enabled: false, transport: 'http', url: 'https://token@example.test/mcp'
    })).toThrow(/bearer-token field/);
    expect(() => validateMcpConfig({
      id: 'x', name: 'x', enabled: false, transport: 'http', url: 'http://example.test/mcp'
    })).toThrow(/must use https/);
    expect(() => validateMcpConfig({
      id: 'x', name: 'x', enabled: false, transport: 'http', url: 'http://127.0.0.1:27123/mcp/'
    })).not.toThrow();
  });
});

describe('MCP secret persistence', () => {
  test('stores environment values outside SQLite and returns only key names', async () => {
    const manager = new McpManager();
    await manager.saveConfig({
      id: 'stdio', name: 'stdio', enabled: false, command: 'npx', env: { API_KEY: 'top-secret' }
    });

    expect(JSON.stringify(row)).not.toContain('top-secret');
    expect(secrets.get('mcp:stdio:env:API_KEY')).toBe('top-secret');
    expect(await manager.listConfigs()).toEqual([
      expect.objectContaining({ envKeys: ['API_KEY'], transport: 'stdio' })
    ]);
    expect((await manager.listConfigs())[0].env).toBeUndefined();
  });

  test('encrypts bearer tokens and exposes only a presence flag', async () => {
    const manager = new McpManager();
    await manager.saveConfig({
      id: 'obsidian', name: 'Obsidian', enabled: false, transport: 'http',
      url: 'https://127.0.0.1:27124/mcp/', bearerToken: 'obsidian-secret', trust: false
    });

    expect(JSON.stringify(row)).not.toContain('obsidian-secret');
    expect(secrets.get('mcp:obsidian:bearer')).toBe('obsidian-secret');
    expect(await manager.listConfigs()).toEqual([
      expect.objectContaining({
        transport: 'http', url: 'https://127.0.0.1:27124/mcp/', hasBearerToken: true
      })
    ]);
    expect((await manager.listConfigs())[0]).not.toHaveProperty('bearerToken');
  });

  test('moves legacy plaintext environment values out of SQLite on read', async () => {
    row = {
      id: 'legacy', name: 'Legacy', enabled: 0, transport: 'stdio', command: 'node',
      args: '[]', env: '{"OLD_TOKEN":"legacy-secret"}', trust: 0
    };

    const configs = await new McpManager().listConfigs();

    expect(row.env).toBe('["OLD_TOKEN"]');
    expect(secrets.get('mcp:legacy:env:OLD_TOKEN')).toBe('legacy-secret');
    expect(configs[0].env).toBeUndefined();
  });
});
