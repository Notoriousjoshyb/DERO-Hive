import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force headless mode and clean env before importing the module under test.
const tmp = mkdtempSync(join(tmpdir(), 'hive-paths-'));
process.env.HIVE_DATA_DIR = tmp;
process.env.HIVE_WORKSPACE = join(tmp, 'workspace');
process.env.HIVE_RESOURCES = join(tmp, 'resources');
// Ensure electron shim path is taken
delete process.env.npm_package_version;

// Import after env setup so module-level constants re-evaluate cleanly.
// Use a fresh require via tsx's ESM loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { paths, getDefaultWorkspace, ensureDirs, resourcesRoot } = require('./paths') as typeof import('./paths');

let failures = 0;
function t(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

t('paths: userData resolves from HIVE_DATA_DIR', () => {
  assert.equal(paths.userData, tmp);
});

t('paths: logs under userData', () => {
  assert.equal(paths.logs, join(tmp, 'logs'));
});

t('paths: db under userData with hive.db filename', () => {
  assert.equal(paths.db, join(tmp, 'hive.db'));
});

t('paths: cache, skills, attachments, artifacts, media all under userData', () => {
  assert.equal(paths.cache, join(tmp, 'cache'));
  assert.equal(paths.skills, join(tmp, 'skills'));
  assert.equal(paths.attachments, join(tmp, 'attachments'));
  assert.equal(paths.artifacts, join(tmp, 'artifacts'));
  assert.equal(paths.media, join(tmp, 'media'));
});

t('paths: secrets file under userData', () => {
  assert.equal(paths.secrets, join(tmp, 'secrets.json'));
});

t('paths: whisper bundles under HIVE_RESOURCES, user under userData', () => {
  assert.equal(paths.whisperBundled, join(tmp, 'resources', 'whisper'));
  assert.equal(paths.whisperUser, join(tmp, 'whisper'));
});

t('resourcesRoot: takes HIVE_RESOURCES env in headless mode', () => {
  assert.equal(resourcesRoot, join(tmp, 'resources'));
});

t('getDefaultWorkspace: honors HIVE_WORKSPACE env', () => {
  const ws = getDefaultWorkspace();
  assert.equal(ws, join(tmp, 'workspace'));
  assert.ok(existsSync(ws), 'workspace should be created on demand');
});

t('ensureDirs: creates all declared subdirectories', () => {
  // Remove any pre-existing so we can observe creation
  for (const sub of ['logs', 'cache', 'skills', 'attachments', 'artifacts', 'media']) {
    const p = join(tmp, sub);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  ensureDirs();
  for (const sub of ['logs', 'cache', 'skills', 'attachments', 'artifacts', 'media']) {
    assert.ok(existsSync(join(tmp, sub)), `${sub} should exist after ensureDirs`);
  }
});

t('ensureDirs: idempotent on repeated calls', () => {
  ensureDirs();
  ensureDirs();
  assert.ok(existsSync(paths.logs));
});

// Cleanup
rmSync(tmp, { recursive: true, force: true });

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log(`paths.test.ts — all ${10} assertions passed`);