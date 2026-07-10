import { app, ipcMain } from 'electron';
import { IPC } from '@shared/types';
import { getProviderConfig } from '../providers/registry';
import { getSecret } from '../utils/secrets';
import { startAgentProxy, stopAgentProxy } from '../agent/proxy';

export function registerAgentHandlers(): void {
  ipcMain.handle(IPC.AGENT_PROXY_START, async (_e, providerId: string) => {
    const cfg = getProviderConfig(providerId);
    if (!cfg || !cfg.enabled) {
      return { ok: false as const, error: 'Provider not found or disabled' };
    }
    // page-agent speaks the OpenAI chat-completions protocol only.
    if (cfg.presetId === 'anthropic' || /anthropic\.com/.test(cfg.baseUrl)) {
      return { ok: false as const, error: 'Agent mode needs an OpenAI-compatible provider (Anthropic is not supported yet)' };
    }
    const { port, token } = await startAgentProxy({
      baseUrl: cfg.baseUrl,
      apiKey: getSecret(`provider:${cfg.id}`) || '',
      customHeaders: cfg.customHeaders
    });
    return { ok: true as const, port, token };
  });

  ipcMain.handle(IPC.AGENT_PROXY_STOP, () => {
    stopAgentProxy();
    return { ok: true };
  });

  app.on('will-quit', () => stopAgentProxy());
}
