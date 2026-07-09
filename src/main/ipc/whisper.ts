import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import type { WhisperManager } from '../whisper/manager';

export function registerWhisperHandlers(manager: WhisperManager): void {
  ipcMain.handle(IPC.WHISPER_STATUS, () => manager.status());

  ipcMain.handle(IPC.WHISPER_START, async (_e, model?: string) => manager.start(model));

  ipcMain.handle(IPC.WHISPER_STOP, async () => {
    await manager.stop();
    return manager.status();
  });

  ipcMain.handle(IPC.WHISPER_TRANSCRIBE, async (_e, { wav, model }: { wav: string; model?: string }) => {
    return manager.transcribe(wav, model);
  });
}
