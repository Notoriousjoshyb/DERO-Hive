import { join } from 'node:path';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { paths } from './paths';
import { ensureDirs } from './paths';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LOG_FILE = join(paths.logs, 'hive.log');

let initialized = false;
function ensureLogDir(): void {
  if (initialized) return;
  try {
    if (!existsSync(paths.logs)) {
      // Use the full ensureDirs helper; falls back to mkdirSync on failure
      try { ensureDirs(); }
      catch {
        if (!existsSync(paths.logs)) mkdirSync(paths.logs, { recursive: true });
      }
    }
    initialized = true;
  } catch {
    // Logging is best-effort; never crash the app over it
  }
}

function safeAppend(line: string): void {
  try { ensureLogDir(); appendFileSync(LOG_FILE, line + '\n'); }
  catch { /* swallow */ }
}

function format(level: Level, scope: string, msg: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] [${scope}] ${msg}`;
}

export const logger = {
  debug(scope: string, msg: string, meta?: unknown): void {
    const line = format('debug', scope, msg) + (meta ? ` ${JSON.stringify(meta)}` : '');
    if (process.env.HIVE_DEBUG) console.log(line);
    safeAppend(line);
  },
  info(scope: string, msg: string, meta?: unknown): void {
    const line = format('info', scope, msg) + (meta ? ` ${JSON.stringify(meta)}` : '');
    console.log(line);
    safeAppend(line);
  },
  warn(scope: string, msg: string, meta?: unknown): void {
    const line = format('warn', scope, msg) + (meta ? ` ${JSON.stringify(meta)}` : '');
    console.warn(line);
    safeAppend(line);
  },
  error(scope: string, msg: string, meta?: unknown): void {
    const line = format('error', scope, msg) + (meta ? ` ${JSON.stringify(meta)}` : '');
    console.error(line);
    safeAppend(line);
  }
};
