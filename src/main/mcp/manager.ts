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
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_MAX_ATTEMPTS = 8;

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
  private reconnectAttempts = new Map<string, number>();

  async ensureBundledServers(): Promise<void> {
    const mcpDir = join(resourcesRoot, 'mcp');
    if (!statSync(mcpDir, { throwIfNoEntry: false })?.isDirectory()) return;

    for (const name of readdirSync(mcpDir)) {
      const serverDir = join(mcpDir, name);
      if (!statSync(serverDir).isDirectory()) continue;

      // Binary bundled server: described by a hive-mcp.json manifest
      // (written by scripts/setup-mcp.mjs) pointing at a native executable.
      const manifestPath = join(serverDir, 'hive-mcp.json');
      if (statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: string; command?: string; args?: string[] };
          const mcpName = manifest.name || name;
          const binPath = manifest.command ? join(serverDir, manifest.command) : '';
          if (!binPath || !statSync(binPath, { throwIfNoEntry: false })?.isFile()) {
            logger.warn('mcp', `bundled server ${mcpName} missing binary: ${binPath || '(no command in manifest)'}`);
            continue;
          }
          await this.registerBundled({
            id: `bundled-${sanitizeId(mcpName)}`,
            name: mcpName,
            enabled: true,
            command: binPath,
            args: manifest.args || [],
            cwd: serverDir,
            timeoutMs: 30_000,
            trust: true
          }, []);
        } catch (err) {
          logger.warn('mcp', `invalid manifest for bundled server ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      const pkgPath = join(serverDir, 'package.json');
      if (!statSync(pkgPath, { throwIfNoEntry: false })?.isFile()) continue;

      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Display under the plain package name; earlier versions registered
      // under the MCP-registry mcpName (e.g. "io.github.DHEBP/dero-mcp-server"),
      // which reads poorly in the UI — drop those legacy rows.
      const pkgName = (pkg.name as string) || name;
      const legacyIds: string[] = [];
      if (typeof pkg.mcpName === 'string' && pkg.mcpName && pkg.mcpName !== pkgName) {
        legacyIds.push(`bundled-${sanitizeId(pkg.mcpName)}`);
      }

      const mainEntry = (pkg.main as string) || './dist/index.js';
      const entryFile = mainEntry.startsWith('./') ? mainEntry.slice(2) : mainEntry;
      const entryPath = join(serverDir, entryFile);
      if (!statSync(entryPath, { throwIfNoEntry: false })?.isFile()) {
        logger.warn('mcp', `bundled server ${pkgName} missing entry: ${entryPath}`);
        continue;
      }

      await this.registerBundled({
        id: `bundled-${sanitizeId(pkgName)}`,
        name: pkgName,
        enabled: true,
        command: process.execPath,
        args: [entryPath],
        cwd: serverDir,
        timeoutMs: 30_000,
        trust: true,
        // Without this the child boots as a second Electron app instead of
        // Node running the server script, and the MCP handshake never happens.
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }, legacyIds);
    }
  }

  /**
   * Insert a bundled server registration, or refresh an existing one whose
   * command/args/cwd/env drifted (paths move between dev and packaged
   * installs). Preserves the user's enabled/trust choices on update and
   * removes superseded legacy registrations.
   */
  private async registerBundled(cfg: McpServerConfig, legacyIds: string[]): Promise<void> {
    for (const legacyId of legacyIds) {
      const legacy = getDb().prepare('SELECT id FROM mcp_servers WHERE id = ?').get(legacyId) as { id: string } | undefined;
      if (legacy) {
        await this.deleteConfig(legacyId);
        logger.info('mcp', `removed legacy bundled registration ${legacyId}`);
      }
    }

    const row = getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(cfg.id) as Record<string, unknown> | undefined;
    if (!row) {
      await this.saveConfig(cfg);
      logger.info('mcp', `registered bundled server ${cfg.name} (${cfg.id})`);
      return;
    }

    const cur = rowToConfig(row);
    const drifted = cur.command !== cfg.command
      || JSON.stringify(cur.args || []) !== JSON.stringify(cfg.args || [])
      || cur.cwd !== cfg.cwd
      || JSON.stringify(cur.env || {}) !== JSON.stringify(cfg.env || {});
    if (drifted) {
      await this.saveConfig({ ...cfg, enabled: cur.enabled, trust: cur.trust });
      logger.info('mcp', `refreshed bundled server ${cfg.name} (${cfg.id})`);
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
      trust: cfg.trust,
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

      // A healthy connection resets the backoff ladder.
      this.reconnectAttempts.delete(cfg.id);

      // Auto-reconnect on disconnect
      transport.onclose = () => this.handleDisconnect(cfg.id, cfg);
      transport.onerror = (err) => logger.warn('mcp', `${cfg.name} transport error: ${err instanceof Error ? err.message : String(err)}`);

      logger.info('mcp', `connected ${cfg.name} (${instance.tools.length} tools, ${instance.resources.length} resources, ${instance.prompts.length} prompts)`);
      this.emitChange();
    } catch (err) {
      instance.status = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      try { await transport.close(); } catch { /* ignore */ }
      this.servers.delete(cfg.id);
      throw err;
    }
  }

  async disconnect(id: string): Promise<void> {
    const timer = this.pendingReconnects.get(id);
    if (timer) { clearTimeout(timer); this.pendingReconnects.delete(id); }
    this.reconnectAttempts.delete(id);
    const inst = this.servers.get(id);
    if (!inst) return;
    // Intentional disconnect — detach the auto-reconnect handler so closing
    // the transport doesn't schedule a reconnect that resurrects the server.
    inst.transport.onclose = undefined;
    try { await inst.transport.close(); } catch { /* ignore */ }
    this.servers.delete(id);
    this.emitChange();
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

  /**
   * Resolve a tool name — either the raw name advertised to the model, or the
   * explicit `mcp:<serverId>:<tool>` form — to its owning server, along with
   * whether that server is trusted. The caller needs the trust bit *before*
   * running the tool, so resolution cannot happen at dispatch time.
   */
  resolveTool(name: string): { serverId: string; toolName: string; trusted: boolean } | null {
    if (name.startsWith('mcp:')) {
      const [, serverId, ...rest] = name.split(':');
      const inst = this.servers.get(serverId);
      if (!inst) return null;
      return { serverId, toolName: rest.join(':'), trusted: !!inst.trust };
    }
    for (const inst of this.servers.values()) {
      if (inst.tools.some((t) => t.name === name)) {
        return { serverId: inst.id, toolName: name, trusted: !!inst.trust };
      }
    }
    return null;
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
    // Back off exponentially and eventually give up. A server that fails on
    // every start — a bad command, a crash, a missing binary — would otherwise
    // respawn a child process every two seconds for the lifetime of the app.
    const attempt = (this.reconnectAttempts.get(id) ?? 0) + 1;
    this.servers.delete(id);

    if (attempt > RECONNECT_MAX_ATTEMPTS) {
      this.reconnectAttempts.delete(id);
      logger.error('mcp', `${cfg.name} gave up after ${RECONNECT_MAX_ATTEMPTS} reconnect attempts`);
      this.emitChange();
      return;
    }

    this.reconnectAttempts.set(id, attempt);
    const delay = Math.min(RECONNECT_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
    logger.warn('mcp', `${cfg.name} disconnected, reconnect attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS} in ${delay}ms`);

    const t = setTimeout(() => {
      this.pendingReconnects.delete(id);
      this.connect(cfg).catch((err) => {
        logger.error('mcp', `reconnect ${cfg.name} failed`, err);
        this.handleDisconnect(id, cfg);
      });
    }, delay);
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

function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '-');
}