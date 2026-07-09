import { ipcMain } from 'electron';
import { IPC, type ToolDefinition } from '@shared/types';
import { BUILTIN_TOOLS } from '../tools/builtin';
import type { McpManager } from '../mcp/manager';

export function registerToolHandlers(mcpManager: McpManager | null): void {
  ipcMain.handle(IPC.TOOL_LIST, () => {
    const builtin: ToolDefinition[] = BUILTIN_TOOLS;
    const mcp = mcpManager?.getAllTools() || [];
    return [...builtin, ...mcp];
  });
}