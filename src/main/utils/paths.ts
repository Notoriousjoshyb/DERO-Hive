import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { App } from 'electron';

let electronApp: App | null | undefined;

function getElectronApp(): App | null {
  if (electronApp !== undefined) return electronApp;
  if (process.versions.electron) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron');
      electronApp = electron.app;
    } catch {
      electronApp = null;
    }
  } else {
    electronApp = null;
  }
  return electronApp;
}

let resourcesRootValue: string | undefined;

function getUserDataPath(): string {
  const app = getElectronApp();
  if (app) return app.getPath('userData');
  const dataDir = process.env.HIVE_DATA_DIR || join(homedir(), '.hive');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function getResourcesRoot(): string {
  if (resourcesRootValue !== undefined) return resourcesRootValue;
  const app = getElectronApp();
  if (app && process.versions.electron) {
    resourcesRootValue = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  } else {
    // CLI / headless: resources are expected next to the working directory
    resourcesRootValue = process.env.HIVE_RESOURCES || join(process.cwd(), 'resources');
  }
  return resourcesRootValue;
}

export const resourcesRoot = getResourcesRoot();

export const paths = {
  get userData() { return getUserDataPath(); },
  get logs() { return join(getUserDataPath(), 'logs'); },
  get db() { return join(getUserDataPath(), 'hive.db'); },
  get cache() { return join(getUserDataPath(), 'cache'); },
  get secrets() { return join(getUserDataPath(), 'secrets.json'); },
  get skills() { return join(getUserDataPath(), 'skills'); },
  get attachments() { return join(getUserDataPath(), 'attachments'); },
  get artifacts() { return join(getUserDataPath(), 'artifacts'); },
  get media() { return join(getUserDataPath(), 'media'); },
  get mcpConfigs() { return join(getUserDataPath(), 'mcp.json'); },
  get whisperBundled() { return join(getResourcesRoot(), 'whisper'); },
  get whisperUser() { return join(getUserDataPath(), 'whisper'); }
};

export function getDefaultWorkspace(): string {
  const app = getElectronApp();
  if (app) {
    const dir = join(app.getPath('documents'), 'DERO Hive');
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    } catch {
      const alt = join(app.getPath('userData'), 'workspace');
      if (!existsSync(alt)) mkdirSync(alt, { recursive: true });
      return alt;
    }
    return dir;
  }
  // CLI / headless default workspace
  const dir = process.env.HIVE_WORKSPACE || join(getUserDataPath(), 'workspace');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  return dir;
}

export function ensureDirs(): void {
  for (const dir of [paths.logs, paths.cache, paths.skills, paths.attachments, paths.artifacts, paths.media]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
