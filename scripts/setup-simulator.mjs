#!/usr/bin/env node
// Builds the DERO blockchain simulator (cmd/simulator from DEROFDN/derohe)
// into resources/simulator/bin/ so the in-app simulator toggle can run it.
// Requires a Go toolchain; skips gracefully when Go or git is unavailable.
// Runs automatically on `npm install` (postinstall) and is idempotent.

import { existsSync, mkdirSync, rmSync, readdirSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, '..', 'resources', 'simulator', 'bin');
const binName = process.platform === 'win32' ? 'derod-simulator.exe' : 'derod-simulator';
const binPath = join(binDir, binName);

// Source tarball rather than `git clone`: the repo vendors a file with CJK
// characters in its name that git-for-windows refuses to checkout, while
// (bsd)tar extracts it fine.
const DEROHE_TARBALL = 'https://github.com/DEROFDN/derohe/archive/refs/heads/main.tar.gz';

// No shell: `go` and `tar` are real executables on every platform, and a
// shell would re-split arguments containing spaces (e.g. paths).
function run(cmd, args, cwd) {
  console.log(`[simulator] ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { cwd, stdio: 'inherit' });
}

function hasGo() {
  return spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0;
}

async function main() {
  if (existsSync(binPath)) {
    console.log(`[simulator] up to date (${binPath})`);
    return;
  }
  if (!hasGo()) {
    console.warn('[simulator] Go toolchain not found — skipping simulator build.');
    console.warn('[simulator] Install Go (https://go.dev/dl) and run "npm run setup:simulator" to build it.');
    return;
  }

  const work = join(tmpdir(), `hive-derohe-${Date.now()}`);
  try {
    mkdirSync(work, { recursive: true });
    const tarball = join(work, 'derohe.tar.gz');
    console.log(`[simulator] downloading ${DEROHE_TARBALL}`);
    const res = await fetch(DEROHE_TARBALL, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText}`);
    await pipeline(res.body, createWriteStream(tarball));

    // Windows ships bsdtar as C:\Windows\System32\tar.exe; unix has tar.
    const r1 = run('tar', ['-xzf', tarball, '-C', work]);
    if (r1.status !== 0) throw new Error('tar extract failed');

    const srcDir = readdirSync(work).map((n) => join(work, n)).find((p) => existsSync(join(p, 'go.mod')));
    if (!srcDir) throw new Error('extracted source tree not found (no go.mod)');

    mkdirSync(binDir, { recursive: true });
    const r2 = run('go', ['build', '-trimpath', '-o', binPath, './cmd/simulator'], srcDir);
    if (r2.status !== 0) throw new Error('go build failed');

    console.log(`[simulator] built ${binPath}`);
  } catch (err) {
    // Never fail the top-level install; the simulator toggle will show
    // "not installed" until the build succeeds.
    console.warn(`[simulator] build failed: ${err.message}`);
    console.warn('[simulator] rerun "npm run setup:simulator" to retry.');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
