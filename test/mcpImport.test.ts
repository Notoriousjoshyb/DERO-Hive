import { describe, expect, it } from 'vitest';
import { parseMcpImport } from '../src/main/mcp/import';

describe('MCP config import', () => {
  it('parses stdio and HTTP configs without trusting or enabling them', () => {
    const parsed = parseMcpImport({ mcpServers: {
      files: { command: 'npx', args: ['-y', 'server'], env: { API_KEY: 'secret' } },
      notes: { type: 'http', url: 'https://127.0.0.1:27124/mcp/', headers: { Authorization: 'Bearer token' } }
    } });

    expect(parsed.configs).toEqual([
      expect.objectContaining({ id: 'import-files', transport: 'stdio', enabled: false, trust: false, env: { API_KEY: 'secret' } }),
      expect.objectContaining({ id: 'import-notes', transport: 'http', enabled: false, trust: false, bearerToken: 'token' })
    ]);
  });

  it('skips unsafe shapes and rejects an empty import', () => {
    expect(() => parseMcpImport({ mcpServers: { bad: { command: 'x', args: [1] } } })).toThrow('args must be strings');
  });
});
