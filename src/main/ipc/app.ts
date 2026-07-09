import { ipcMain, shell, app } from 'electron';
import { IPC } from '@shared/types';

function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, (_e, url: string) => {
    if (!isAllowedExternalUrl(url)) throw new Error(`URL not allowed: ${url}`);
    return shell.openExternal(url);
  });
  ipcMain.handle(IPC.APP_PLATFORM, () => process.platform);
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());
}
