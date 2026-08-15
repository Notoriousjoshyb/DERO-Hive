import { ipcMain } from 'electron';
import { IPC, type ToolDefinition } from '@shared/types';
import { listBuiltinTools } from '../tools/builtin';
import type { McpManager } from '../mcp/manager';

export function registerToolHandlers(mcpManager: McpManager | null): void {
  ipcMain.handle(IPC.TOOL_LIST, () => {
    // Same capability-aware list the model sees, so the UI never shows a tool
    // the agent cannot call.
    const builtin: ToolDefinition[] = listBuiltinTools();
    const mcp = mcpManager?.getAllTools() || [];
    return [...builtin, ...mcp];
  });
}