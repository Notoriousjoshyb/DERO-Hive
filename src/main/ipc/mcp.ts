import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IPC, type McpImportPickResult, type McpImportResult, type McpServerConfig, type McpRegistry } from '@shared/types';
import { validateMcpConfig, type McpManager } from '../mcp/manager';
import { logger } from '../utils/logger';
import { parseMcpImport } from '../mcp/import';

// Bundled Discover registry. Ships inside the asar (it is not an extraResource),
// so it must be resolved from app.getAppPath(), not process.resourcesPath.
let registryCache: McpRegistry | null = null;
const pendingImports = new Map<string, { configs: McpServerConfig[]; expiresAt: number }>();

function loadRegistry(): McpRegistry {
  if (registryCache) return registryCache;
  try {
    const raw = readFileSync(join(app.getAppPath(), 'resources', 'mcp-registry.json'), 'utf-8');
    registryCache = JSON.parse(raw) as McpRegistry;
    return registryCache;
  } catch (err) {
    logger.warn('mcp', 'failed to load bundled server registry', err);
    return { version: 0, updatedAt: '', servers: [] };
  }
}

/**
 * Registering an MCP server means launching a program with the user's
 * privileges, and `mcp:save` is reachable from the renderer. Ask for consent in
 * a native dialog — which page script cannot click — whenever the command being
 * run is new or changed, or when a server is being escalated to "trusted" (its
 * tools then run without any per-call confirmation).
 *
 * Bundled servers are registered by McpManager.ensureBundledServers(), which
 * calls saveConfig() directly and never passes through here.
 *
 * Exported so the consent rules can be tested without driving a native dialog.
 */
export async function confirmServerLaunch(
  manager: McpManager,
  cfg: McpServerConfig,
  parent: BrowserWindow | null,
  force = false
): Promise<boolean> {
  const existing = (await manager.listConfigs()).find((c) => c.id === cfg.id);
  const sameEndpoint = existing && existing.transport === cfg.transport && (
    cfg.transport === 'http'
      ? existing.url === cfg.url
      : existing.transport !== 'http'
        && existing.command === cfg.command
        && JSON.stringify(existing.args ?? []) === JSON.stringify(cfg.args ?? [])
  );
  const escalatingTrust = !!cfg.trust && !existing?.trust;
  const enablingImported = !!existing?.id.startsWith('import-') && !existing.enabled && cfg.enabled;

  // Renaming, ordinary enable toggles, or dropping trust need no new consent.
  // Imported configs are deliberately unconsented until their first enable/connect.
  if (!force && sameEndpoint && !escalatingTrust && !enablingImported) return true;

  const endpoint = cfg.transport === 'http'
    ? [`Endpoint: ${cfg.url}`]
    : [
        `Command:   ${cfg.command}`,
        `Arguments: ${(cfg.args ?? []).join(' ') || '(none)'}`,
        ...(cfg.cwd ? [`Directory: ${cfg.cwd}`] : [])
      ];
  const detail = [
    ...endpoint,
    '',
    cfg.transport === 'http'
      ? 'This lets the server provide tools and receive data sent through those tools.'
      : "This runs a program on your computer with your account's permissions.",
    ...(cfg.trust ? ['', 'Its tools will run WITHOUT asking you first.'] : [])
  ].join('\n');

  const opts = {
    type: 'warning' as const,
    title: cfg.transport === 'http' ? 'Connect to this MCP server?' : 'Run this MCP server?',
    message: `DERO Hive is about to ${cfg.transport === 'http' ? 'connect to' : 'launch'} "${cfg.name}".`,
    detail,
    buttons: ['Cancel', cfg.transport === 'http' ? 'Connect' : 'Run server'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts);
  return response === 1;
}

export function registerMcpHandlers(manager: McpManager): void {
  manager.on('change', (statuses) => {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send(IPC.MCP_CHANGED, statuses);
    });
  });

  ipcMain.handle(IPC.MCP_LIST, () => manager.listConfigs());
  ipcMain.handle(IPC.MCP_SAVE, async (e, cfg: McpServerConfig) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    if (!await confirmServerLaunch(manager, cfg, parent)) {
      return { ok: false, cancelled: true };
    }
    await manager.saveConfig(cfg);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_DELETE, async (_e, id: string) => {
    await manager.deleteConfig(id);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_CONNECT, async (_e, id: string) => {
    const cfgs = await manager.listConfigs();
    const cfg = cfgs.find((c) => c.id === id);
    if (!cfg) throw new Error('MCP server not found');
    const parent = BrowserWindow.fromWebContents(_e.sender);
    if (!await confirmServerLaunch(manager, cfg, parent, true)) return { ok: false, cancelled: true };
    await manager.connect(cfg);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_DISCONNECT, async (_e, id: string) => {
    await manager.disconnect(id);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_STATUS, () => manager.getStatuses());
  ipcMain.handle(IPC.MCP_REGISTRY, () => loadRegistry());
  ipcMain.handle(IPC.MCP_IMPORT_PICK, async (e): Promise<McpImportPickResult> => {
    for (const [token, pending] of pendingImports) if (pending.expiresAt < Date.now()) pendingImports.delete(token);
    const parent = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(parent!, {
      properties: ['openFile'],
      filters: [{ name: 'MCP JSON configuration', extensions: ['json'] }]
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const raw = readFileSync(picked.filePaths[0]);
      if (raw.length > 1024 * 1024) return { ok: false, error: 'MCP config is larger than 1 MB' };
      const parsed = parseMcpImport(JSON.parse(raw.toString('utf-8')));
      const existing = new Set((await manager.listConfigs()).map((cfg) => cfg.id));
      const token = randomUUID();
      pendingImports.set(token, { configs: parsed.configs, expiresAt: Date.now() + 5 * 60_000 });
      return {
        ok: true,
        preview: {
          token,
          sourceName: basename(picked.filePaths[0]),
          warnings: parsed.warnings,
          servers: parsed.configs.map((cfg) => ({
            id: cfg.id,
            name: cfg.name,
            transport: cfg.transport === 'http' ? 'http' : 'stdio',
            endpoint: cfg.transport === 'http' ? cfg.url : [cfg.command, ...(cfg.args || [])].join(' '),
            envKeys: Object.keys(cfg.env || {}),
            conflict: existing.has(cfg.id)
          }))
        }
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IPC.MCP_IMPORT, async (_e, input: { token: string; replace: boolean }): Promise<McpImportResult> => {
    const pending = pendingImports.get(input.token);
    pendingImports.delete(input.token);
    if (!pending || pending.expiresAt < Date.now()) return { ok: false, error: 'Import preview expired; choose the file again' };
    try {
      const existing = new Set((await manager.listConfigs()).map((cfg) => cfg.id));
      const selected = pending.configs.filter((cfg) => input.replace || !existing.has(cfg.id));
      for (const cfg of selected) validateMcpConfig(cfg);
      let imported = 0;
      let skipped = 0;
      for (const cfg of pending.configs) {
        if (existing.has(cfg.id) && !input.replace) { skipped++; continue; }
        await manager.saveConfig({ ...cfg, enabled: false, trust: false });
        imported++;
      }
      return { ok: true, imported, skipped };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
