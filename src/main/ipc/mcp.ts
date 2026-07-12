import { app, ipcMain, BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type McpRegistry, type McpServerConfig } from '@shared/types';
import type { McpManager } from '../mcp/manager';
import { logger } from '../utils/logger';

let cachedRegistry: McpRegistry | null | undefined;

function loadMcpRegistry(): McpRegistry | null {
  if (cachedRegistry !== undefined) return cachedRegistry;
  try {
    // Bundled via the electron-builder `files` glob (packed into app.asar),
    // not extraResources — so resolve it from the app path like the bundled
    // skills do, not from process.resourcesPath.
    const raw = readFileSync(join(app.getAppPath(), 'resources', 'mcp-registry.json'), 'utf-8');
    cachedRegistry = JSON.parse(raw) as McpRegistry;
  } catch (err) {
    logger.warn('mcp', `could not load bundled mcp-registry.json: ${err instanceof Error ? err.message : String(err)}`);
    cachedRegistry = null;
  }
  return cachedRegistry;
}

export function registerMcpHandlers(manager: McpManager): void {
  manager.on('change', (statuses) => {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send(IPC.MCP_CHANGED, statuses);
    });
  });

  ipcMain.handle(IPC.MCP_LIST, () => manager.listConfigs());
  ipcMain.handle(IPC.MCP_SAVE, async (_e, cfg: McpServerConfig) => {
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
  ipcMain.handle(IPC.MCP_REGISTRY, () => loadMcpRegistry() ?? { version: 0, updatedAt: '', servers: [] });
}