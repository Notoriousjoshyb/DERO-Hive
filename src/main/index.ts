import { app, BrowserWindow, shell, ipcMain, dialog, Menu, nativeTheme, protocol, net } from 'electron';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IPC } from '../shared/types';
import { registerChatHandlers } from './ipc/chat';
import { registerProviderHandlers, startModelRefreshScheduler } from './ipc/providers';
import { registerMcpHandlers } from './ipc/mcp';
import { registerSkillHandlers } from './ipc/skills';
import { registerPromptHandlers } from './ipc/prompts';
import { registerFsHandlers } from './ipc/fs';
import { registerShellHandlers } from './ipc/shell';
import { registerSettingsHandlers } from './ipc/settings';
import { registerConvHandlers } from './ipc/conversations';
import { registerArtifactHandlers } from './ipc/artifacts';
import { registerAppHandlers } from './ipc/app';
import { registerToolHandlers } from './ipc/tools';
import { registerGithubHandlers } from './ipc/github';
import { registerProjectHandlers } from './ipc/projects';
import { registerAuditHandlers } from './ipc/audit';
import { registerCheckpointHandlers } from './ipc/checkpoints';
import { registerPermissionHandlers } from './ipc/permissions';
import { registerWhisperHandlers } from './ipc/whisper';
import { registerSimulatorHandlers } from './ipc/simulator';
import { registerKnowledgeHandlers } from './ipc/knowledge';
import { registerMediaHandlers } from './ipc/media';
import { MediaManager } from './media/manager';
import { setMediaManager } from './media/instance';
import { initDb, closeDb, getSetting } from './db/client';
import { initSecrets } from './utils/secrets';
import { logger } from './utils/logger';
import { ensureDirs } from './utils/paths';
import { McpManager } from './mcp/manager';
import { WhisperManager } from './whisper/manager';
import { SimulatorManager } from './simulator/manager';
import { setSimulatorManager } from './simulator/instance';
import { BrowserBridge } from './browserBridge';
import { terminalDisposeAll } from './terminal/session';
import { shutdownAdapterCache } from './providers/registry';
import { initializeKnowledgeService, getKnowledgeService } from './knowledge/service';
import { KnowledgeAutomationScheduler } from './knowledge/automation';
import type { AppSettings } from '../shared/types';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | null = null;
let mcpManager: McpManager | null = null;
let whisperManager: WhisperManager | null = null;
let simulatorManager: SimulatorManager | null = null;
let mediaManager: MediaManager | null = null;
let browserBridge: BrowserBridge | null = null;
let knowledgeAutomations: KnowledgeAutomationScheduler | null = null;

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false, // custom titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#262624',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // No <webview> is used anywhere in the renderer; leaving the tag enabled
      // only widens the attack surface.
      webviewTag: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', { fullscreen: true });
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', { fullscreen: false });
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' };
  });

  // Block in-app navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('http://localhost') || url.startsWith('file://');
    const isHttp = /^https?:\/\//i.test(url);
    if (!isLocal && isHttp) {
      event.preventDefault();
      shell.openExternal(url);
    } else if (!isLocal) {
      event.preventDefault();
    }
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Conversation',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('app:menu', { action: 'new-conversation' })
        },
        {
          label: 'Open Project Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory']
            });
            if (!result.canceled && result.filePaths[0]) {
              mainWindow?.webContents.send('app:project-opened', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('app:menu', { action: 'toggle-sidebar' })
        },
        {
          label: 'Toggle Vision',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => mainWindow?.webContents.send('app:menu', { action: 'toggle-vision' })
        },
        {
          label: 'Toggle Code Tab',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('app:menu', { action: 'toggle-code-tab' })
        },
        {
          label: 'Toggle Right Sidebar',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('app:menu', { action: 'toggle-right-sidebar' })
        },
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('app:menu', { action: 'open-settings' })
        }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About DERO Hive',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'DERO Hive',
              message: 'DERO Hive',
              detail: `Version ${app.getVersion()}\nA feature-rich AI harness.`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Only allow a single running instance. A second launch focuses the existing
// window instead of spawning a rival process that fights over the shared cache
// directory (the source of the "Unable to move the cache: Access is denied" and
// GPU disk-cache errors on Windows).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// GPU shader disk-cache creation frequently fails on Windows profiles and only
// produces noise; disable it so real errors stay visible. Must be set before ready.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Custom scheme used to stream generated media (image/video/audio) files from
// the userData/project media folders into the renderer's <img>/<video>/<audio>
// tags. Registered as privileged so it supports range requests (seeking) and
// the fetch API. Must be declared before the app 'ready' event.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hive-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
]);

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  electronApp.setAppUserModelId('com.dero.hive');

  // Ensure userData subdirs exist before any logger write
  ensureDirs();

  // Hardware accel tweaks for Windows
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Init DB + secrets BEFORE registering handlers
  await initDb();
  await initSecrets();

  // Init MCP manager. Connect to enabled servers in the background so a slow
  // or failing server (e.g., dero-mcp-server) never blocks the window from showing.
  mcpManager = new McpManager();
  await mcpManager.ensureBundledServers();
  void mcpManager.loadFromSettings().catch((err) => {
    logger.error('mcp', 'background load failed', err);
  });

  // Init Whisper.cpp local STT manager. Pushes status changes to the renderer.
  whisperManager = new WhisperManager((status) => {
    mainWindow?.webContents.send(IPC.WHISPER_STATUS_CHANGED, status);
  });

  // Init DERO blockchain simulator manager. Pushes status changes to the renderer.
  simulatorManager = new SimulatorManager((status) => {
    mainWindow?.webContents.send(IPC.SIMULATOR_STATUS_CHANGED, status);
  });
  setSimulatorManager(simulatorManager);
  browserBridge = new BrowserBridge(() => mainWindow, () => whisperManager, () => getKnowledgeService());
  // The browser extension should work whenever the app is running, so the
  // loopback bridge starts with the app instead of with the Companion panel.
  void browserBridge.setEnabled(true).catch((err) => logger.error('browser-bridge', 'failed to start', err));

  // Init media generation manager (image / video / audio). Files are served to
  // the renderer through the hive-media:// protocol handled here.
  mediaManager = new MediaManager();
  setMediaManager(mediaManager);
  // Repair artifacts written by an earlier build with a broken filename/path.
  mediaManager.repairArtifactPaths();

  // hive-media://artifact/<id> → stream the artifact file from disk. Only ids
  // that resolve to a known artifact are served, so the renderer cannot read
  // arbitrary paths through this scheme.
  protocol.handle('hive-media', async (request) => {
    try {
      const url = new URL(request.url);
      // host is the resource type ("artifact"); first path segment is the id.
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, '').split('/')[0] || '');
      if (!id) return new Response('Bad request', { status: 400 });
      const file = mediaManager?.artifactFileById(id);
      if (!file) return new Response('Not found', { status: 404 });
      const res = await net.fetch(pathToFileURL(file.path).toString(), {
        headers: request.headers,
        method: request.method
      });
      // Ensure a correct content-type so <video>/<audio> pick the right decoder.
      if (file.mimeType) {
        const headers = new Headers(res.headers);
        headers.set('Content-Type', file.mimeType);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return res;
    } catch (err) {
      logger.warn('media', `hive-media protocol error: ${String(err)}`);
      return new Response('Error', { status: 500 });
    }
  });

  // Init project knowledge vault: routes reads/writes through a
  // user-configured Obsidian MCP server, plus the digest/synthesis scheduler.
  const knowledgeService = initializeKnowledgeService(mcpManager);
  knowledgeAutomations = new KnowledgeAutomationScheduler(knowledgeService);
  knowledgeAutomations.start();

  // Register IPC handlers
  registerChatHandlers(() => mainWindow, mcpManager);
  registerProviderHandlers();
  startModelRefreshScheduler();
  registerMcpHandlers(mcpManager);
  registerSkillHandlers();
  registerPromptHandlers();
  registerFsHandlers();
  registerShellHandlers();
  registerSettingsHandlers();
  registerConvHandlers();
  registerArtifactHandlers();
  registerAppHandlers();
  registerToolHandlers(mcpManager);
  registerGithubHandlers();
  registerProjectHandlers();
  registerAuditHandlers();
  registerCheckpointHandlers();
  registerPermissionHandlers();
  registerWhisperHandlers(whisperManager);
  registerSimulatorHandlers(simulatorManager);
  registerKnowledgeHandlers(knowledgeService, knowledgeAutomations);
  if (mediaManager) registerMediaHandlers(mediaManager);
  ipcMain.handle(IPC.BROWSER_BRIDGE_SET_ENABLED, (_event, enabled: boolean) => browserBridge?.setEnabled(Boolean(enabled)) ?? { enabled: false, port: 43120, paired: false });
  ipcMain.handle(IPC.BROWSER_BRIDGE_STATUS, () => browserBridge?.status() ?? { enabled: false, port: 43120, paired: false });
  ipcMain.handle(IPC.BROWSER_BRIDGE_BIND, (_event, requestId: string, conversationId: string) => browserBridge?.bind(requestId, conversationId) ?? { ok: false });
  ipcMain.handle(IPC.BROWSER_BRIDGE_SELECTION, (_event, providerId?: string, model?: string, activeProject?: { id: string; name: string }) => browserBridge?.reportSelection(providerId, model, activeProject) ?? { ok: false });
  ipcMain.handle(IPC.BROWSER_BRIDGE_REVOKE_PAIRING, () => browserBridge?.revokePairing() ?? { enabled: false, port: 43120, paired: false });

  // Window controls (custom titlebar)
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
    return mainWindow?.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:toggleFullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    const fs = mainWindow.isFullScreen();
    mainWindow.webContents.send('window:fullscreen-changed', { fullscreen: fs });
    return fs;
  });

  buildAppMenu();
  await createMainWindow();

  // Auto-start local Whisper STT unless the user disabled it. Runs in the
  // background so it never blocks the window from showing.
  {
    const settings = getSetting<AppSettings>('appSettings') || ({} as AppSettings);
    const enabled = settings.whisperEnabled !== false; // default on
    if (enabled && whisperManager?.isInstalled()) {
      void whisperManager.start(settings.whisperModel).catch((err) => {
        logger.error('whisper', `auto-start failed: ${String(err)}`);
      });
    }
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try { terminalDisposeAll(); } catch { /* ignore */ }
  try { await shutdownAdapterCache(); } catch { /* ignore */ }
  try { await simulatorManager?.stop(); } catch { /* ignore */ }
  try { await knowledgeAutomations?.shutdown(); } catch { /* ignore */ }
  try { await browserBridge?.stop(); } catch { /* ignore */ }
  try { browserBridge?.dispose(); } catch { /* ignore */ }
  try { await whisperManager?.stop(); } catch { /* ignore */ }
  try { await mcpManager?.shutdownAll(); } catch { /* ignore */ }
  closeDb();
  app.exit(0);
});

// Security: block new windows from non-allowed origins
app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
});

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('app:theme-changed', {
    themeSource: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors
  });
});

logger.info('app', 'main process ready');

