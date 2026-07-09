import { ipcMain } from 'electron';
import { IPC, type AppSettings } from '@shared/types';
import { getSetting, setSetting } from '../db/client';

const DEFAULTS: AppSettings = {
  theme: 'dark',
  fontSize: 'medium',
  interfaceFont: 'inter',
  codeFont: 'jetbrains-mono',
  interfaceFontSize: 120,
  terminalFontSize: 15,
  spacingDensity: 100,
  inputBarOffset: 0,
  sendOnEnter: true,
  showTokenUsage: true,
  showReasoning: true,
  autoTitle: true,
  maxConcurrentToolCalls: 4,
  toolApprovalMode: 'always',
  telemetry: false,
  experimentalFeatures: false,
  voiceNotificationSounds: true,
  voiceNotificationVolume: 0.5,
  codeTheme: 'vscode'
};

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return { ...DEFAULTS, ...(getSetting<AppSettings>('appSettings') || {}) };
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_e, partial: Partial<AppSettings>) => {
    const cur = { ...DEFAULTS, ...(getSetting<AppSettings>('appSettings') || {}) };
    const next = { ...cur, ...partial };
    setSetting('appSettings', next);
    return next;
  });
}