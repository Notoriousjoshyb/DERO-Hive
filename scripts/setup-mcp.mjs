#!/usr/bin/env node
// Installs dependencies and builds bundled MCP servers under resources/mcp/*.
// Runs automatically on `npm install` (postinstall) and is idempotent.

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpDir = join(__dirname, '..', 'resources', 'mcp');

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
