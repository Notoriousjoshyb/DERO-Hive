import { ipcMain } from 'electron';
import { IPC, type IntegrationId } from '@shared/types';
import type { IntegrationRegistry } from '../integrations/registry';

const IDS = new Set<IntegrationId>(['hologram', 'purewolf', 'hermes']);

function validId(value: unknown): value is IntegrationId {
  return typeof value === 'string' && IDS.has(value as IntegrationId);
}

export function registerIntegrationHandlers(registry: IntegrationRegistry): void {
  ipcMain.handle(IPC.INTEGRATION_LIST, () => registry.list());
  ipcMain.handle(IPC.INTEGRATION_START, (_event, id: unknown) => {
    if (!validId(id)) throw new Error('Unknown integration.');
    return registry.start(id);
  });
  ipcMain.handle(IPC.INTEGRATION_STOP, async (_event, id: unknown) => {
    if (!validId(id)) throw new Error('Unknown integration.');
    return registry.stop(id);
  });
}
