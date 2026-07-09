import { ipcMain, BrowserWindow } from 'electron';
import { IPC, type McpServerConfig } from '@shared/types';
import type { McpManager } from '../mcp/manager';

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
}