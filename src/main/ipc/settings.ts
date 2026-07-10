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
  maxAgenticRounds: 20,
  toolApprovalMode: 'always',
  telemetry: false,
  experimentalFeatures: false,
  voiceNotificationSounds: true,
  voiceNotificationVolume: 0.5,
  codeTheme: 'vscode',
  spellcheckEnabled: true,
  spellcheckLanguage: 'en',
  focusModeTimerMinutes: 25,
  focusModeWordGoal: 0,
  ttsEnabled: false,
  dailyTokenBudget: 0,
  monthlyTokenBudget: 0
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
