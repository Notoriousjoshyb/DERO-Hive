import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EventEmitter } from 'node:events';
import type { McpServerConfig, McpServerStatus, ToolDefinition } from '@shared/types';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { resourcesRoot } from '../utils/paths';
import { isPathWithin } from '../utils/pathPolicy';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { McpServerInstance } from './client';

const RECONNECT_DELAY_MS = 2000;

function validateMcpConfig(cfg: McpServerConfig): void {
  if (!cfg.command || typeof cfg.command !== 'string') {
    throw new Error('MCP server command must be a non-empty string');
  }
  if (cfg.args !== undefined && !Array.isArray(cfg.args)) {
    throw new Error('MCP server args must be an array of strings');
  }
  if (cfg.args) {
    for (const a of cfg.args) {
      if (typeof a !== 'string') throw new Error('MCP server args must be strings');
    }
  }
  if (cfg.cwd) {
    if (!isPathWithin(cfg.cwd, resourcesRoot) && !isPathWithin(cfg.cwd, process.cwd())) {
      throw new Error(`MCP server cwd outside allowed roots: ${cfg.cwd}`);
    }
  }
}


export class McpManager extends EventEmitter {
  private servers = new Map<string, McpServerInstance>();
  private pendingReconnects = new Map<string, NodeJS.Timeout>();

  async ensureBundledServers(): Promise<void> {
    const mcpDir = join(resourcesRoot, 'mcp');
    if (!statSync(mcpDir, { throwIfNoEntry: false })?.isDirectory()) return;

    for (const name of readdirSync(mcpDir)) {
      const serverDir = join(mcpDir, name);
      if (!statSync(serverDir).isDirectory()) continue;
      const pkgPath = join(serverDir, 'package.json');
      if (!statSync(pkgPath, { throwIfNoEntry: false })?.isFile()) continue;

      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        continue;
      }

      const mcpName = (pkg.mcpName as string) || (pkg.name as string) || name;
      const id = `bundled-${mcpName.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
      const existing = getDb().prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id) as { id: string } | undefined;
      if (existing) continue;

      const mainEntry = (pkg.main as string) || './dist/index.js';
      const entryFile = mainEntry.startsWith('./') ? mainEntry.slice(2) : mainEntry;
      const entryPath = join(serverDir, entryFile);
      if (!statSync(entryPath, { throwIfNoEntry: false })?.isFile()) {
        logger.warn('mcp', `bundled server ${mcpName} missing entry: ${entryPath}`);
        continue;
      }

      const cfg: McpServerConfig = {
        id,
        name: mcpName,
        enabled: true,
        command: process.execPath,
        args: [entryPath],
        cwd: serverDir,
        timeoutMs: 30_000,
        trust: true
      };

      await this.saveConfig(cfg);
      logger.info('mcp', `registered bundled server ${mcpName} (${id})`);
    }
  }

  async loadFromSettings(): Promise<void> {
    const rows = getDb().prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all() as Array<Record<string, unknown>>;
    // Connect in parallel with a short startup timeout so a slow or hanging
    // server (e.g. dero-mcp-server waiting for a remote daemon) does not
    // delay other servers or the app window.
    const STARTUP_TIMEOUT_MS = 10_000;
    await Promise.allSettled(
      rows.map(async (row) => {
        const cfg = rowToConfig(row);
        const cfgWithStartupTimeout = { ...cfg, timeoutMs: Math.min(cfg.timeoutMs ?? STARTUP_TIMEOUT_MS, STARTUP_TIMEOUT_MS) };
        try {
          await this.connect(cfgWithStartupTimeout);
        } catch (err) {
          logger.warn('mcp', `failed to connect ${cfg.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    );
    this.emitChange();
  }

  async listConfigs(): Promise<McpServerConfig[]> {
    const rows = getDb().prepare('SELECT * FROM mcp_servers ORDER BY name').all() as Array<Record<string, unknown>>;
    return rows.map(rowToConfig);
  }

  async saveConfig(cfg: McpServerConfig): Promise<void> {
    validateMcpConfig(cfg);
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO mcp_servers (id, name, enabled, command, args, env, cwd, timeout_ms, trust, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        command = excluded.command,
        args = excluded.args,
        env = excluded.env,
        cwd = excluded.cwd,
        timeout_ms = excluded.timeout_ms,
        trust = excluded.trust,
        updated_at = excluded.updated_at
    `).run(
      cfg.id, cfg.name, cfg.enabled ? 1 : 0, cfg.command,
      JSON.stringify(cfg.args || []),
      JSON.stringify(cfg.env || {}),
      cfg.cwd || null, cfg.timeoutMs || null, cfg.trust ? 1 : 0, now
    );

    // Reconnect if enabled
    await this.disconnect(cfg.id);
    if (cfg.enabled) {
      try { await this.connect(cfg); } catch (err) { logger.warn('mcp', `reconnect failed for ${cfg.name}: ${err instanceof Error ? err.message : String(err)}`); }
    }
    this.emitChange();
  }

  async deleteConfig(id: string): Promise<void> {
    getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    await this.disconnect(id);
    this.emitChange();
  }

  async connect(cfg: McpServerConfig): Promise<void> {
    validateMcpConfig(cfg);
    if (this.servers.has(cfg.id)) {
      logger.debug('mcp', `${cfg.name} already connected`);
      return;
    }
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args || [],
      env: cfg.env as Record<string, string>,
      cwd: cfg.cwd
    });

    const client = new Client(
      { name: 'dero-hive', version: '0.1.0' },
      { capabilities: {} }
    );

    const instance: McpServerInstance = {
      id: cfg.id,
      client,
      transport,
      status: 'connecting',
      tools: [], resources: [], prompts: []
    };
    this.servers.set(cfg.id, instance);

    const timeoutMs = cfg.timeoutMs ?? 30_000;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Connection timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      await Promise.race([client.connect(transport), timeout]);
      instance.status = 'connected';

      // Discover tools, resources, prompts
      const [toolsRes, resourcesRes, promptsRes] = await Promise.allSettled([
        client.listTools(),
        client.listResources(),
        client.listPrompts()
      ]);

      if (toolsRes.status === 'fulfilled') {
        instance.tools = (toolsRes.value.tools || []).map((t) => ({
          name: t.name,
          description: t.description || '',
          parameters: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
          source: `mcp:${cfg.id}` as const
        }));
      }
      if (resourcesRes.status === 'fulfilled') {
        instance.resources = (resourcesRes.value.resources || []).map((r) => ({
          name: r.name,
          uri: r.uri,
          description: r.description,
          mimeType: r.mimeType
        }));
      }
      if (promptsRes.status === 'fulfilled') {
        instance.prompts = (promptsRes.value.prompts || []).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments as unknown[]
        }));
      }

      // Auto-reconnect on disconnect
      transport.onclose = () => this.handleDisconnect(cfg.id, cfg);
      transport.onerror = (err) => logger.warn('mcp', `${cfg.name} transport error: ${err instanceof Error ? err.message : String(err)}`);

      logger.info('mcp', `connected ${cfg.name} (${instance.tools.length} tools, ${instance.resources.length} resources, ${instance.prompts.length} prompts)`);
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      try { await transport.close(); } catch { /* ignore */ }
      this.servers.delete(cfg.id);
      throw err;
    }
  }

  async disconnect(id: string): Promise<void> {
    const inst = this.servers.get(id);
    if (!inst) return;
    const timer = this.pendingReconnects.get(id);
    if (timer) { clearTimeout(timer); this.pendingReconnects.delete(id); }
    try { await inst.transport.close(); } catch { /* ignore */ }
    this.servers.delete(id);
  }

  async shutdownAll(): Promise<void> {
    const all = Array.from(this.servers.keys());
    await Promise.allSettled(all.map((id) => this.disconnect(id)));
  }

  getInstance(id: string): McpServerInstance | undefined {
    return this.servers.get(id);
  }

  getAllTools(): ToolDefinition[] {
    const out: ToolDefinition[] = [];
    for (const inst of this.servers.values()) out.push(...inst.tools);
    return out;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ content: unknown; isError?: boolean }> {
    const inst = this.servers.get(serverId);
    if (!inst) throw new Error(`MCP server ${serverId} not connected`);
    const result = await inst.client.callTool({ name: toolName, arguments: args });
    return { content: result.content, isError: result.isError as boolean | undefined };
  }

  getStatuses(): McpServerStatus[] {
    const rows = getDb().prepare('SELECT * FROM mcp_servers ORDER BY name').all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const cfg = rowToConfig(row);
      const inst = this.servers.get(cfg.id);
      return {
        id: cfg.id,
        name: cfg.name,
        connected: inst?.status === 'connected',
        error: inst?.error,
        tools: inst?.tools || [],
        resources: inst?.resources || [],
        prompts: inst?.prompts || []
      };
    });
  }

  private handleDisconnect(id: string, cfg: McpServerConfig): void {
    logger.warn('mcp', `${cfg.name} disconnected, attempting reconnect in ${RECONNECT_DELAY_MS}ms`);
    this.servers.delete(id);
    const t = setTimeout(() => {
      this.pendingReconnects.delete(id);
      this.connect(cfg).catch((err) => {
        logger.error('mcp', `reconnect ${cfg.name} failed`, err);
        this.handleDisconnect(id, cfg);
      });
    }, RECONNECT_DELAY_MS);
    this.pendingReconnects.set(id, t);
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change', this.getStatuses());
  }
}

function rowToConfig(row: Record<string, unknown>): McpServerConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    enabled: row.enabled === 1,
    command: row.command as string,
    args: safeJson(row.args as string, [] as string[]),
    env: safeJson(row.env as string, {} as Record<string, string>),
    cwd: row.cwd as string | undefined,
    timeoutMs: row.timeout_ms as number | undefined,
    trust: row.trust === 1
  };
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}