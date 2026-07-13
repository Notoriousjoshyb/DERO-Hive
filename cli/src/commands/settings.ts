import { Command } from 'commander';
import { input } from '@inquirer/prompts';
import { getDb } from '../../../src/main/db/client.js';
import * as format from '../utils/format.js';

export function settingsCommand() {
  const cmd = new Command('settings').description('Manage Hive settings');

  cmd
    .command('get <key>')
    .description('Get a setting value')
    .action((key) => {
      const value = getSetting(key);
      console.log(value === undefined ? 'undefined' : JSON.stringify(value, null, 2));
    });

  cmd
    .command('set <key> [value]')
    .description('Set a setting value (JSON)')
    .action(async (key, value) => {
      let parsed: unknown;
      if (value !== undefined) {
        try { parsed = JSON.parse(value); } catch { parsed = value; }
      } else {
        const raw = await input({ message: `Value for ${key}:` });
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      }
      setSetting(key, parsed);
      format.printSuccess(`Set ${key}`);
    });

  cmd
    .command('list')
    .description('List all settings')
    .action(() => {
      const rows = getDb().prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{ key: string; value: string }>;
      for (const row of rows) {
        console.log(`${row.key}: ${row.value.slice(0, 200)}`);
      }
    });

  return cmd;
}

// JSON-or-string result to avoid as-unknown-as T
type JsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; raw: string };

function parseSetting<T>(row: { value: string }): JsonResult<T> {
  try {
    return { ok: true, value: JSON.parse(row.value) as T };
  } catch {
    return { ok: false, raw: row.value };
  }
}

function getSetting<T>(key: string, fallback?: T): T | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  const result = parseSetting<T>(row);
  if (result.ok) return result.value;
  // Stored value is not valid JSON — fall back to raw string for string-typed requests,
  // otherwise return the fallback to avoid returning a wrongly-typed raw string.
  if (typeof fallback === 'string') return result.raw as unknown as T;
  return fallback;
}

function setSetting(key: string, value: unknown): void {
  getDb().prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, JSON.stringify(value), Date.now());
}
