import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.cwd(), 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js');
if (!existsSync(file)) process.exit(0);

const source = readFileSync(file, 'utf8');
const patched = source
  .replace(
    'codex = process.platform === "win32" ? spawn(`"${codexPath}" app-server`, { shell: true, env: spawnEnv }) : spawn(codexPath, ["app-server"], { env: spawnEnv });',
    'codex = spawn(codexPath, ["app-server"], { env: spawnEnv, windowsHide: true });'
  )
  .replace(
    'codex = spawn(process.execPath, [bundledCodexPath, "app-server"], { env: spawnEnv });',
    'codex = spawn(process.execPath, [bundledCodexPath, "app-server"], { env: spawnEnv, windowsHide: true });'
  );

if (patched !== source) {
  writeFileSync(file, patched, 'utf8');
} else if (!source.includes('windowsHide: true')) {
  throw new Error('Unsupported codex-acp version: the Windows hidden-window patch could not be applied.');
}
