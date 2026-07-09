#!/usr/bin/env node
// Installs dependencies and builds bundled MCP servers under resources/mcp/*.
// Node servers (package.json) are npm-installed and built; binary servers are
// downloaded from GitHub releases and registered via a hive-mcp.json manifest.
// Runs automatically on `npm install` (postinstall) and is idempotent.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, renameSync, rmSync, chmodSync, createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpDir = join(__dirname, '..', 'resources', 'mcp');

// Binary MCP servers fetched from GitHub releases (version-pinned).
const CBM_VERSION = 'v0.9.0';
const BINARY_SERVERS = [
  {
    name: 'codebase-memory-mcp',
    description: 'Code intelligence MCP server — indexes codebases into a persistent knowledge graph (github.com/DeusData/codebase-memory-mcp)',
    binName: process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp',
    asset: () => {
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      if (process.platform === 'win32') return `codebase-memory-mcp-windows-${arch}.zip`;
      if (process.platform === 'darwin') return `codebase-memory-mcp-darwin-${arch}.tar.gz`;
      return `codebase-memory-mcp-linux-${arch}.tar.gz`;
    },
    url: (asset) => `https://github.com/DeusData/codebase-memory-mcp/releases/download/${CBM_VERSION}/${asset}`
  }
];

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText} (${url})`);
  await pipeline(res.body, createWriteStream(dest));
}

function extract(archive, destDir) {
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
        { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('Expand-Archive failed');
    } else {
      const r = spawnSync('unzip', ['-o', archive, '-d', destDir], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('unzip failed');
    }
  } else {
    const r = spawnSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('tar extract failed');
  }
}

async function ensureBinaryServer(spec) {
  const serverDir = join(mcpDir, spec.name);
  const binDir = join(serverDir, 'bin');
  const binPath = join(binDir, spec.binName);
  const manifestPath = join(serverDir, 'hive-mcp.json');

  if (existsSync(binPath) && existsSync(manifestPath)) {
    console.log(`[mcp] ${spec.name} is up to date`);
    return;
  }

  const asset = spec.asset();
  const url = spec.url(asset);
  const tmp = join(tmpdir(), `hive-mcp-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  console.log(`[mcp] downloading ${spec.name} (${asset}) — this can take a while...`);
  const archive = join(tmp, asset);
  await download(url, archive);
  extract(archive, tmp);

  // Locate the extracted binary (top level or one directory deep).
  let found = null;
  const search = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isFile() && entry.name === spec.binName) { found = p; return; }
      if (entry.isDirectory() && depth < 2 && !found) search(p, depth + 1);
    }
  };
  search(tmp, 0);
  if (!found) throw new Error(`binary ${spec.binName} not found in ${asset}`);

  if (existsSync(binPath)) rmSync(binPath, { force: true });
  renameSync(found, binPath);
  if (process.platform !== 'win32') chmodSync(binPath, 0o755);

  writeFileSync(manifestPath, JSON.stringify({
    name: spec.name,
    description: spec.description,
    version: CBM_VERSION,
    command: `bin/${spec.binName}`,
    args: []
  }, null, 2));

  rmSync(tmp, { recursive: true, force: true });
  console.log(`[mcp] ${spec.name} installed at ${binPath}`);
}

function shouldRebuild(serverDir) {
  const pkg = join(serverDir, 'package.json');
  if (!existsSync(pkg)) return false;
  const dist = join(serverDir, 'dist');
  const nm = join(serverDir, 'node_modules');
  if (!existsSync(nm) || !existsSync(dist)) return true;
  const pkgMtime = statSync(pkg).mtimeMs;
  const distMtime = statSync(dist).mtimeMs;
  const nmMtime = statSync(nm).mtimeMs;
  return pkgMtime > distMtime || pkgMtime > nmMtime;
}

function run(cmd, args, cwd) {
  console.log(`[mcp] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

async function main() {
  if (!existsSync(mcpDir)) {
    mkdirSync(mcpDir, { recursive: true });
  }

  // Binary servers first (download is best-effort — never fail the install).
  for (const spec of BINARY_SERVERS) {
    try {
      await ensureBinaryServer(spec);
    } catch (err) {
      console.warn(`[mcp] failed to install ${spec.name}: ${err.message}`);
      console.warn(`[mcp] ${spec.name} will not be available; rerun "npm run setup:mcp" to retry.`);
    }
  }

  const servers = readdirSync(mcpDir).filter((name) => {
    const dir = join(mcpDir, name);
    return statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'));
  });

  if (servers.length === 0) {
    console.log('[mcp] no bundled MCP servers found');
    return;
  }

  for (const name of servers) {
    const serverDir = join(mcpDir, name);
    console.log(`[mcp] bundled server: ${name}`);
    if (!shouldRebuild(serverDir)) {
      console.log(`[mcp] ${name} is up to date`);
      continue;
    }
    try {
      run('npm', ['install'], serverDir);
      run('npm', ['run', 'build'], serverDir);
      console.log(`[mcp] ${name} built`);
    } catch (err) {
      // Never fail the top-level install; the MCP server just won't be available.
      console.warn(`[mcp] failed to build ${name}: ${err.message}`);
      console.warn(`[mcp] ${name} will not be available until the build succeeds.`);
    }
  }
}

main();
