import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import type { SimulatorManager } from '../simulator/manager';
import type { SimulatorStartOptions } from '@shared/types';

export function registerSimulatorHandlers(manager: SimulatorManager): void {
  ipcMain.handle(IPC.SIMULATOR_STATUS, () => manager.status());

  ipcMain.handle(IPC.SIMULATOR_START, async (_e, options?: SimulatorStartOptions) =>
    manager.start(options)
  );

  ipcMain.handle(IPC.SIMULATOR_STOP, async () => {
    await manager.stop();
    return manager.status();
  });

  ipcMain.handle(IPC.SIMULATOR_RESTART, async (_e, options?: SimulatorStartOptions) =>
    manager.restart(options)
  );
}
