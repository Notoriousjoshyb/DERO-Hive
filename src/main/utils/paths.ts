import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

// Bundled read-only resources ship in `resources/` during dev and are copied to
// `process.resourcesPath` by electron-builder's extraResources in production.
export const resourcesRoot = app.isPackaged
  ? process.resourcesPath
  : join(app.getAppPath(), 'resources');

export const paths = {
  userData: app.getPath('userData'),
  logs: join(app.getPath('userData'), 'logs'),
  db: join(app.getPath('userData'), 'hive.db'),
  cache: join(app.getPath('userData'), 'cache'),
  secrets: join(app.getPath('userData'), 'secrets.json'),
  skills: join(app.getPath('userData'), 'skills'),
  attachments: join(app.getPath('userData'), 'attachments'),
  artifacts: join(app.getPath('userData'), 'artifacts'),
  mcpConfigs: join(app.getPath('userData'), 'mcp.json'),
  // Whisper.cpp binary + models. Bundled binaries live under resources/whisper;
  // user-added models can also live in userData/whisper/models.
  whisperBundled: join(resourcesRoot, 'whisper'),
  whisperUser: join(app.getPath('userData'), 'whisper')
};

export function ensureDirs(): void {
  for (const dir of [paths.logs, paths.cache, paths.skills, paths.attachments, paths.artifacts]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}