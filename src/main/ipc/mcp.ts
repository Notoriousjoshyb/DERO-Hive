import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type McpServerConfig, type McpRegistry } from '@shared/types';
import type { McpManager } from '../mcp/manager';
import { logger } from '../utils/logger';

// Bundled Discover registry. Ships inside the asar (it is not an extraResource),
// so it must be resolved from app.getAppPath(), not process.resourcesPath.
let registryCache: McpRegistry | null = null;

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
  parent: BrowserWindow | null
): Promise<boolean> {
  const existing = (await manager.listConfigs()).find((c) => c.id === cfg.id);
  const sameCommand = existing
    && existing.command === cfg.command
    && JSON.stringify(existing.args ?? []) === JSON.stringify(cfg.args ?? []);
  const escalatingTrust = !!cfg.trust && !existing?.trust;

  // Renaming a server, toggling `enabled`, or dropping trust needs no consent.
  if (sameCommand && !escalatingTrust) return true;

  const args = (cfg.args ?? []).join(' ');
  const detail = [
    `Command:   ${cfg.command}`,
    `Arguments: ${args || '(none)'}`,
    ...(cfg.cwd ? [`Directory: ${cfg.cwd}`] : []),
    '',
    "This runs a program on your computer with your account's permissions.",
    ...(cfg.trust ? ['', 'Its tools will run WITHOUT asking you first.'] : [])
  ].join('\n');

  const opts = {
    type: 'warning' as const,
    title: 'Run this MCP server?',
    message: `DERO Hive is about to launch "${cfg.name}".`,
    detail,
    buttons: ['Cancel', 'Run server'],
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
    await manager.connect(cfg);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_DISCONNECT, async (_e, id: string) => {
    await manager.disconnect(id);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_STATUS, () => manager.getStatuses());
  ipcMain.handle(IPC.MCP_REGISTRY, () => loadRegistry());
}