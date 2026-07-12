import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import type { SimulatorManager } from '../simulator/manager';
import type { SimulatorStartOptions } from '@shared/types';
import { lintDvmBasic } from '@shared/dvm';

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
  ipcMain.handle(IPC.SIMULATOR_HEALTH, () => manager.health());
  ipcMain.handle(IPC.SIMULATOR_INFO, () => manager.chainInfo());
  ipcMain.handle(IPC.SIMULATOR_CREATE_FIXTURE_WALLET, () => manager.createFixtureWallet());
  ipcMain.handle(IPC.SIMULATOR_GET_BALANCE, (_e, address: string, scid?: string) => manager.getBalance(address, scid));
  ipcMain.handle(IPC.SIMULATOR_GET_CONTRACT_STATE, (_e, scid: string, keys?: string[]) => manager.getContractState(scid, keys));
  ipcMain.handle(IPC.SIMULATOR_GET_HEIGHT, () => manager.getHeight());
  ipcMain.handle(IPC.DERO_LINT, (_e, source: unknown) => {
    if (typeof source !== 'string') throw new Error('DVM-BASIC source must be text');
    if (source.length > 250_000) throw new Error('DVM-BASIC source exceeds the 250 KB analysis limit');
    return lintDvmBasic(source);
  });
}
