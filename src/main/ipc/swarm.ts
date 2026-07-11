import { BrowserWindow, ipcMain } from 'electron';
import { IPC, type SwarmStartRequest } from '@shared/types';
import { SwarmManager } from '../swarm/manager';

export function registerSwarmHandlers(getWin: () => BrowserWindow | null): SwarmManager {
  const manager = new SwarmManager((run) => {
    getWin()?.webContents.send(IPC.SWARM_PROGRESS, { run });
  });

  ipcMain.handle(IPC.SWARM_START, (_event, request: SwarmStartRequest) => manager.start(request));
  ipcMain.handle(IPC.SWARM_GET, (_event, runId: string) => manager.get(runId));
  ipcMain.handle(IPC.SWARM_LIST, (_event, limit?: number) => manager.list(limit));
  ipcMain.handle(IPC.SWARM_ABORT, (_event, runId: string) => manager.abort(runId));
  ipcMain.handle(IPC.SWARM_RESUME, (_event, runId: string) => manager.resume(runId));
  ipcMain.handle(IPC.SWARM_APPLY, (_event, runId: string) => manager.apply(runId));
  return manager;
}
