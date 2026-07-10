import type { McpServerConfig } from '@shared/types';

type JsonObject = Record<string, unknown>;

export interface ParsedMcpImport {
  configs: McpServerConfig[];
  warnings: string[];
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function importId(name: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  if (!safe) throw new Error('MCP server name must contain a letter or number');
  return `import-${safe}`;
}

export function parseMcpImport(value: unknown): ParsedMcpImport {
  const root = object(value);
  const servers = object(root?.mcpServers ?? root);
  if (!servers) throw new Error('Expected an object containing mcpServers');
  const entries = Object.entries(servers);
  if (entries.length === 0) throw new Error('No MCP servers found');
  if (entries.length > 50) throw new Error('MCP config contains too many servers');

  const configs: McpServerConfig[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  for (const [name, raw] of entries) {
    const entry = object(raw);
    if (!entry) { warnings.push(`${name}: skipped invalid entry`); continue; }
    const id = importId(name);
    if (ids.has(id)) throw new Error(`MCP server names collide after normalization: ${name}`);
    ids.add(id);

    if (typeof entry.url === 'string') {
      const headers = object(entry.headers);
      const authorization = typeof headers?.Authorization === 'string'
        ? headers.Authorization
        : typeof headers?.authorization === 'string' ? headers.authorization : undefined;
      const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (headers && Object.keys(headers).some((key) => key.toLowerCase() !== 'authorization')) {
        warnings.push(`${name}: non-Authorization HTTP headers were not imported`);
      }
      configs.push({ id, name, enabled: false, transport: 'http', url: entry.url, bearerToken, trust: false });
      continue;
    }

    if (typeof entry.command !== 'string' || !entry.command.trim()) {
      warnings.push(`${name}: skipped because command or URL is missing`);
      continue;
    }
    const args = entry.args === undefined ? [] : entry.args;
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      warnings.push(`${name}: skipped because args must be strings`);
      continue;
    }
    const rawEnv = entry.env === undefined ? {} : object(entry.env);
    if (!rawEnv || Object.values(rawEnv).some((v) => typeof v !== 'string')) {
      warnings.push(`${name}: skipped because environment values must be strings`);
      continue;
    }
    const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined;
    configs.push({
      id, name, enabled: false, transport: 'stdio', command: entry.command.trim(), args,
      env: rawEnv as Record<string, string>, cwd, trust: false
    });
  }

  if (configs.length === 0) throw new Error(warnings.join('; ') || 'No valid MCP servers found');
  return { configs, warnings };
}
