import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The main process imports `electron` and `better-sqlite3`, neither of which
// loads under plain Node (better-sqlite3 is built against Electron's ABI).
// Alias both to stubs: tests that need a database inject a real one built on
// `node:sqlite`, so the code under test still talks to SQLite, not a mock.
export default defineConfig({
  resolve: {
    alias: {
      electron: resolve(__dirname, 'test/stubs/electron.ts'),
      'better-sqlite3': resolve(__dirname, 'test/stubs/better-sqlite3.ts'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
