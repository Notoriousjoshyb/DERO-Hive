// Minimal `electron` stand-in for tests. Only the surface the main-process
// modules touch at import time needs to exist; nothing here is under test.
export const app = {
  getPath: (name: string) => `/tmp/hive-test/${name}`,
  getAppPath: () => '/tmp/hive-test/app',
  getVersion: () => '0.0.0-test'
};

export const ipcMain = { handle: () => {}, on: () => {} };

export const BrowserWindow = Object.assign(
  function BrowserWindow() {} as unknown as { new (): unknown },
  { getAllWindows: () => [], fromWebContents: () => null }
);

export const dialog = {
  showMessageBox: async () => ({ response: 0 }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] })
};

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString()
};

export const shell = { openExternal: async () => {} };
export const nativeTheme = { on: () => {}, shouldUseDarkColors: true };
export const Menu = { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) };
export const protocol = { handle: () => {} };
