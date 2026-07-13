import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Provide safe env vars before requiring the module.
const tmpRoot = mkdtempSync(join(tmpdir(), 'hive-mcp-cfg-'));
process.env.HIVE_DATA_DIR = tmpRoot;
process.env.HIVE_CLI = '1';
const workspace = join(tmpRoot, 'ws');
mkdirSync(workspace, { recursive: true });
process.env.HIVE_WORKSPACE = workspace;

const ROOT = process.env.HIVE_DATA_DIR ?? '';
process.env.HIVE_DATA_DIR = ROOT;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateMcpConfig } = require('./manager') as typeof import('./manager');
type McpServerConfig = import('@shared/types').McpServerConfig;

let failures = 0;
function t(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

const baseStdio: McpServerConfig = {
  id: 'a', name: 'A', enabled: true, transport: 'stdio', command: 'echo', args: []
};
const baseHttp: McpServerConfig = {
  id: 'a', name: 'A', enabled: true, transport: 'http', url: 'http://127.0.0.1:8000/mcp'
};

// ── happy paths ───────────────────────────────────────────────────
t('stdio: minimal valid config passes', () => {
  validateMcpConfig(baseStdio);
});

t('http: loopback http url passes', () => {
  validateMcpConfig(baseHttp);
});

t('http: https url passes', () => {
  validateMcpConfig({ id: 'a', name: 'A', enabled: true, transport: 'http', url: 'https://mcp.example.com/sse' });
});

t('stdio: with args array passes', () => {
  validateMcpConfig({ id: 'x', name: 'X', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server'] });
});

t('stdio: with cwd inside workspace passes', () => {
  validateMcpConfig({ id: 'a', name: 'A', enabled: true, transport: 'stdio', command: 'node', args: [], cwd: workspace });
});

// ── id / name validation ──────────────────────────────────────────
t('missing id throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, id: '' }));
});

t('whitespace-only id throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, id: '   ' }));
});

t('missing name throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, name: '' }));
});

// ── transport validation ──────────────────────────────────────────
t('unsupported transport throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, transport: 'websocket' as unknown as 'stdio' }));
});

// ── http-specific validation ───────────────────────────────────────
t('http: invalid url throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseHttp, url: 'not://a url' }));
});

t('http: non-http protocol throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseHttp, url: 'ftp://127.0.0.1/x' }));
});

t('http: remote http (non-loopback) throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseHttp, url: 'http://mcp.example.com/x' }));
});

t('http: https to non-loopback passes', () => {
  validateMcpConfig({ id: 'a', name: 'A', enabled: true, transport: 'http', url: 'https://mcp.example.com/x' });
});

t('http: credentials in url throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseHttp, url: 'http://user:pass@127.0.0.1/x' }));
});

t('http: localhost accepted as loopback', () => {
  validateMcpConfig({ id: 'a', name: 'A', enabled: true, transport: 'http', url: 'http://localhost:8080/x' });
});

// ── stdio-specific validation ──────────────────────────────────────
t('stdio: missing command throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, command: '' }));
});

t('stdio: non-string command throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, command: 42 as unknown as string }));
});

t('stdio: non-array args throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, args: 'hello' as unknown as string[] }));
});

t('stdio: non-string arg throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, args: [42 as unknown as string] }));
});

t('stdio: cwd outside workspace throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, cwd: join(tmpRoot, 'sibling') }));
});

// ── env validation ────────────────────────────────────────────────
t('env: empty keys throw', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, env: { '': 'v' } }));
});

t('env: keys containing = throw', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, env: { 'BAD=KEY': 'v' } }));
});

t('env: keys containing \\0 throw', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, env: { 'BAD\0KEY': 'v' } }));
});

t('env: non-string values throw', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, env: { KEY: 42 as unknown as string } }));
});

t('env: array value throws', () => {
  assert.throws(() => validateMcpConfig({ ...baseStdio, env: { KEY: [] as unknown as string } }));
});

t('env: valid entries pass', () => {
  validateMcpConfig({ ...baseStdio, env: { API_KEY: 'secret', DEBUG: '1' } });
});

// cleanup
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall assertions passed');
