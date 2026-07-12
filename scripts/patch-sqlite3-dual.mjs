// Builds better-sqlite3 for BOTH Electron and system Node, then patches the
// loader so the correct native binary is selected at runtime:
//   - Electron -> build/Release/better_sqlite3.electron.node
//   - system Node -> build/Release/better_sqlite3.system.node
// This lets `npm run dev` (GUI) and `hive` (CLI) coexist without rebuilding.
//
// Self-contained: always rebuilds for Electron first, then system Node, so it
// does not depend on whatever state the default binary was in before running.
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const sqliteDir = join(root, 'node_modules', 'better-sqlite3');
const releaseDir = join(sqliteDir, 'build', 'Release');
const defaultBin = join(releaseDir, 'better_sqlite3.node');
const electronBin = join(releaseDir, 'better_sqlite3.electron.node');
const systemBin = join(releaseDir, 'better_sqlite3.system.node');
const dbJs = join(sqliteDir, 'lib', 'database.js');

if (!existsSync(sqliteDir)) {
  console.log('[patch-sqlite3-dual] better-sqlite3 not installed, skipping.');
  process.exit(0);
}

function run(cmd, label) {
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit', timeout: 180000 });
    return true;
  } catch (err) {
    console.error(`[patch-sqlite3-dual] ${label} failed: ${err.message}`);
    return false;
  }
}

// Step 1: Build for the installed Electron runtime. This overwrites defaultBin.
const electronOk = run('npx electron-rebuild -f -w better-sqlite3', 'electron-rebuild');
if (electronOk && existsSync(defaultBin)) {
  copyFileSync(defaultBin, electronBin);
  console.log('[patch-sqlite3-dual] saved Electron build -> better_sqlite3.electron.node');
} else {
  // Fall back: if electronBin already exists from a prior run, keep it.
  if (existsSync(electronBin)) {
    console.log('[patch-sqlite3-dual] electron-rebuild failed, keeping existing electron bin.');
  } else {
    console.error('[patch-sqlite3-dual] no Electron binary available. GUI will fail.');
  }
}

// Step 2: Build for the active system Node runtime. This overwrites defaultBin.
const systemOk = run('npm rebuild better-sqlite3', 'system rebuild');
if (systemOk && existsSync(defaultBin)) {
  copyFileSync(defaultBin, systemBin);
  console.log('[patch-sqlite3-dual] saved system-Node build -> better_sqlite3.system.node');
} else if (existsSync(systemBin)) {
  console.log('[patch-sqlite3-dual] system rebuild failed, keeping existing system bin.');
} else {
  console.error('[patch-sqlite3-dual] no system binary available. CLI will fail.');
}

// Step 3: Patch database.js to load the right binary at runtime.
const PATCH_MARKER = '// [patch-sqlite3-dual]';
const source = readFileSync(dbJs, 'utf8');

if (source.includes(PATCH_MARKER)) {
  console.log('[patch-sqlite3-dual] loader already patched.');
} else {
  const original = "addon = DEFAULT_ADDON || (DEFAULT_ADDON = require('bindings')('better_sqlite3.node'));";
  const replacement = `${PATCH_MARKER}
	const _releaseDir = path.join(__dirname, '..', 'build', 'Release');
	const _isElectron = !!process.versions.electron;
	const _runtimeBin = path.join(_releaseDir, _isElectron ? 'better_sqlite3.electron.node' : 'better_sqlite3.system.node');
	addon = DEFAULT_ADDON || (DEFAULT_ADDON = fs.existsSync(_runtimeBin) ? require(_runtimeBin) : require('bindings')('better_sqlite3.node'));`;

  if (!source.includes(original)) {
    console.error('[patch-sqlite3-dual] WARNING: could not find the bindings line to patch in database.js');
    process.exit(0);
  }
  writeFileSync(dbJs, source.replace(original, replacement), 'utf8');
  console.log('[patch-sqlite3-dual] patched database.js to select runtime binary.');
}

console.log('[patch-sqlite3-dual] done. GUI (npm run dev) and CLI (hive) can now coexist.');
