import { ipcMain } from 'electron';
import { IPC, normalizeToolApprovalMode, type AppSettings } from '@shared/types';
import { getSetting, setSetting } from '../db/client';
import { setSecret, getSecret, deleteSecret } from '../utils/secrets';

/**
 * Secrets the settings UI may write, by exact name. An allowlist, not a
 * pattern: this channel exists so one panel can store one kind of API key, and
 * a renderer bug must not be able to overwrite provider credentials through it.
 * Values are write-only from the renderer — it can ask whether a key is set,
 * never what it is.
 */
const WRITABLE_SECRETS = new Set(['websearch:brave', 'websearch:tavily']);

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
    return normalizeSettings(getSetting<AppSettings>('appSettings'));
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_e, partial: Partial<AppSettings>) => {
    const cur = normalizeSettings(getSetting<AppSettings>('appSettings'));
    const next = normalizeSettings({ ...cur, ...partial });
    setSetting('appSettings', next);
    return next;
  });

  ipcMain.handle(IPC.SETTINGS_SET_SECRET, (_e, key: string, value: string) => {
    if (!WRITABLE_SECRETS.has(key)) throw new Error(`Not a settings secret: ${key}`);
    if (value) setSecret(key, value);
    else deleteSecret(key);
    return { ok: true, hasValue: !!value };
  });

  ipcMain.handle(IPC.SETTINGS_HAS_SECRET, (_e, key: string) => {
    if (!WRITABLE_SECRETS.has(key)) return false;
    return !!getSecret(key);
  });
}

function normalizeSettings(value?: Partial<AppSettings>): AppSettings {
  const saved = { ...(value || {}) } as Partial<AppSettings> & { toolApprovalMode?: unknown };
  return {
    ...DEFAULTS,
    ...saved,
    toolApprovalMode: normalizeToolApprovalMode(saved.toolApprovalMode)
  };
}
