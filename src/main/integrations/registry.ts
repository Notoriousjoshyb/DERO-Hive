import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { IPC, type IntegrationId, type IntegrationStatus } from '@shared/types';
import { logger } from '../utils/logger';

export interface IntegrationRoots {
  resources: string;
  appPath: string;
  userData: string;
  home: string;
}

const COMMON_DESKTOP_ENV = [
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE'
] as const;

const PLATFORM_DESKTOP_ENV: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  win32: ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC'],
  darwin: ['PATH'],
  linux: ['PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']
};

const NAMES = {
  hologram: 'Hologram',
  purewolf: 'PureWolf',
  hermes: 'Hermes Gateway'
} as const;

export function sidecarBinaryCandidates(
  id: 'hologram' | 'purewolf',
  platform: NodeJS.Platform,
  roots: IntegrationRoots,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const binary = id === 'hologram'
    ? (platform === 'win32' ? 'Hologram.exe' : 'Hologram')
    : (platform === 'win32' ? 'purewolf-native.exe' : 'purewolf-native');
  const override = id === 'hologram' ? env.DERO_HIVE_HOLOGRAM_PATH : env.DERO_HIVE_PUREWOLF_PATH;
  const path = platform === 'win32' ? win32 : posix;
  const paths = [
    override,
    path.join(roots.resources, 'integrations', id, 'bin', binary),
    path.join(roots.appPath, 'resources', 'integrations', id, 'bin', binary),
    path.join(roots.userData, 'integrations', id, binary)
  ];
  if (id === 'purewolf') paths.push(path.join(roots.home, '.purewolf', binary));
  return [...new Set(paths.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

export function validGatewayEndpoint(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function desktopEnvironment(
  platform: NodeJS.Platform,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of [...COMMON_DESKTOP_ENV, ...(PLATFORM_DESKTOP_ENV[platform] ?? ['PATH'])]) {
    const value = source[key];
    if (value !== undefined) selected[key] = value;
  }
  return selected;
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export class IntegrationRegistry {
  private hologram: ChildProcess | null = null;
  private hologramError: string | null = null;

  private roots(): IntegrationRoots {
    return {
      resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      home: app.getPath('home')
    };
  }

  private binary(id: 'hologram' | 'purewolf'): string | null {
    return sidecarBinaryCandidates(id, process.platform, this.roots()).find(isFile) ?? null;
  }

  status(id: IntegrationId): IntegrationStatus {
    if (id === 'hermes') {
      const raw = process.env.HERMES_GATEWAY_URL;
      const endpoint = validGatewayEndpoint(raw);
      return {
        id,
        name: NAMES[id],
        kind: 'gateway',
        launchMode: 'external',
        optional: true,
        installed: endpoint !== null,
        running: false,
        pid: null,
        binaryPath: null,
        endpoint,
        error: raw && !endpoint ? 'HERMES_GATEWAY_URL must be a credential-free HTTP or HTTPS URL.' : null
      };
    }

    const binaryPath = this.binary(id);
    const running = id === 'hologram' && this.hologram !== null && this.hologram.exitCode === null;
    return {
      id,
      name: NAMES[id],
      kind: id === 'hologram' ? 'desktop-sidecar' : 'native-host',
      launchMode: id === 'hologram' ? 'managed' : 'browser',
      optional: true,
      installed: binaryPath !== null,
      running,
      pid: running ? this.hologram?.pid ?? null : null,
      binaryPath,
      endpoint: null,
      error: id === 'hologram' ? this.hologramError : null
    };
  }

  list(): IntegrationStatus[] {
    return (['hologram', 'purewolf', 'hermes'] as const).map((id) => this.status(id));
  }

  start(id: IntegrationId): IntegrationStatus {
    if (id !== 'hologram') return this.status(id);
    if (this.hologram && this.hologram.exitCode === null) return this.status(id);

    const binaryPath = this.binary(id);
    if (!binaryPath) {
      this.hologramError = 'Hologram binary is not installed.';
      return this.emit(id);
    }

    this.hologramError = null;
    try {
      const child = spawn(binaryPath, [], {
        cwd: dirname(binaryPath),
        env: desktopEnvironment(process.platform),
        windowsHide: false,
        stdio: 'ignore'
      });
      this.hologram = child;
      child.once('error', (error) => {
        this.hologramError = error.message;
        this.hologram = null;
        this.emit(id);
      });
      child.once('exit', (code) => {
        if (this.hologram === child) this.hologram = null;
        if (code !== 0 && code !== null) this.hologramError = `Hologram exited with code ${code}.`;
        this.emit(id);
      });
      logger.info('integrations', `started Hologram pid=${child.pid ?? 'unknown'}`);
    } catch (error) {
      this.hologramError = error instanceof Error ? error.message : String(error);
      this.hologram = null;
    }
    return this.emit(id);
  }

  async stop(id: IntegrationId): Promise<IntegrationStatus> {
    if (id !== 'hologram' || !this.hologram) return this.status(id);
    const child = this.hologram;
    this.hologram = null;
    try { child.kill(); } catch { /* already stopped */ }
    return this.emit(id);
  }

  async shutdown(): Promise<void> {
    await this.stop('hologram');
  }

  private emit(id: IntegrationId): IntegrationStatus {
    const status = this.status(id);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.INTEGRATION_CHANGED, status);
    }
    return status;
  }
}
