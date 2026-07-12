import { ipcMain, BrowserWindow, shell } from 'electron';
import { IPC, type MediaGenerationRequest, type MediaProviderConfig } from '@shared/types';
import type { MediaManager } from '../media/manager';
import { logger } from '../utils/logger';

export function registerMediaHandlers(manager: MediaManager): void {
  // Forward status events from the manager to every BrowserWindow.
  manager.onEvent((evt) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send(IPC.MEDIA_STATUS_CHANGED, evt); } catch { /* ignore */ }
    }
  });

  ipcMain.handle(IPC.MEDIA_LIST, () => {
    return {
      artifacts: manager.listArtifacts(),
      providers: manager.listProviders(),
      presets: manager.presets()
    };
  });

  ipcMain.handle(IPC.MEDIA_SAVE_PROVIDER, (_e, cfg: MediaProviderConfig & { apiKey?: string }) => {
    try {
      const saved = manager.saveProvider(cfg);
      return { ok: true, provider: saved };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.MEDIA_DELETE_PROVIDER, (_e, id: string) => {
    try { manager.deleteProvider(id); return { ok: true }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle(IPC.MEDIA_TEST_PROVIDER, async (_e, id: string) => {
    return manager.testProvider(id);
  });

  ipcMain.handle(IPC.MEDIA_GENERATE, async (_e, req: MediaGenerationRequest & { conversationId?: string; messageId?: string }) => {
    try {
      const { conversationId, messageId, ...generation } = req;
      const rec = await manager.generate(generation, { conversationId, messageId });
      return { ok: true, artifact: rec };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.MEDIA_CANCEL, (_e, id: string) => {
    return { ok: manager.cancel(id) };
  });

  ipcMain.handle(IPC.MEDIA_DELETE_ARTIFACT, (_e, id: string) => manager.deleteArtifact(id));

  ipcMain.handle(IPC.MEDIA_OPEN_ARTIFACT, (_e, id: string) => {
    const rec = manager.listArtifacts().find((a) => a.id === id);
    if (!rec) return { ok: false, error: 'not found' };
    const abs = manager.absolutePathFor(rec);
    if (!abs) return { ok: false, error: 'no path' };
    void shell.openPath(abs).catch((err) => logger.warn('media', `openPath failed: ${String(err)}`));
    return { ok: true };
  });

  ipcMain.handle(IPC.MEDIA_REVEAL_ARTIFACT, (_e, id: string) => {
    const rec = manager.listArtifacts().find((a) => a.id === id);
    if (!rec) return { ok: false, error: 'not found' };
    const abs = manager.absolutePathFor(rec);
    if (!abs) return { ok: false, error: 'no path' };
    void shell.showItemInFolder(abs);
    return { ok: true };
  });
}
