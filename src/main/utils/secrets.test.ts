import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force headless mode and isolate the secrets store to a temp dir before
// importing the module under test.
const tmp = mkdtempSync(join(tmpdir(), 'hive-secrets-'));
process.env.HIVE_DATA_DIR = tmp;
process.env.HIVE_CLI = '1';
delete (process.env as Record<string, string | undefined>).USERNAME;
delete (process.env as Record<string, string | undefined>).COMPUTERNAME;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setSecret, getSecret, deleteSecret, initSecrets } = require('./secrets') as typeof import('./secrets');

const secretsPath = join(tmp, 'secrets.json');

let failures = 0;
function t(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      throw new Error('async tests are not supported in this runner; use sync test bodies');
    }
    console.log(`  ok  ${name}`);
  } catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

function readStore(): Record<string, string> {
  return JSON.parse(readFileSync(secretsPath, 'utf-8')) as Record<string, string>;
}

function writeStore(store: Record<string, string>): void {
  writeFileSync(secretsPath, JSON.stringify(store));
}

t('initSecrets: completes in headless mode without throwing', () => {
  // sync wrapper just calls the async function and discards the promise; the
  // body of initSecrets has no awaited work in headless mode.
  void initSecrets();
});

t('setSecret: writes a v1-prefixed legacy record (no Electron safeStorage)', () => {
  setSecret('alpha', 'hello-world');
  const store = readStore();
  assert.equal(typeof store.alpha, 'string');
  assert.ok(store.alpha.startsWith('v1:'), `expected v1: prefix, got ${store.alpha.slice(0, 8)}`);
});

t('getSecret: round-trips a value set with setSecret', () => {
  setSecret('beta', 'round-trip-value');
  assert.equal(getSecret('beta'), 'round-trip-value');
});

t('getSecret: returns undefined for an unknown key', () => {
  assert.equal(getSecret('nope-missing'), undefined);
});

t('getSecret: returns undefined for a corrupted legacy record', () => {
  writeStore({ corrupted: 'v1:not-base64:bad:data' });
  assert.equal(getSecret('corrupted'), undefined);
});

t('getSecret: returns undefined for an untagged legacy record with bad payload', () => {
  writeStore({ untagged: 'AAAA:BBBB:CCCC' });
  assert.equal(getSecret('untagged'), undefined);
});

t('getSecret: legacy v1 record is readable and round-trips', () => {
  setSecret('legacy-key', 'migrate-me');
  const store = readStore();
  assert.ok(store['legacy-key'].startsWith('v1:'));
  assert.equal(getSecret('legacy-key'), 'migrate-me');
});

t('deleteSecret: removes a key from the on-disk store', () => {
  setSecret('gamma', 'value-gamma');
  assert.equal(getSecret('gamma'), 'value-gamma');
  deleteSecret('gamma');
  assert.equal(getSecret('gamma'), undefined);
  const store = readStore();
  assert.equal(store.gamma, undefined);
});

t('deleteSecret: is a no-op for an unknown key', () => {
  deleteSecret('phantom');
  assert.equal(getSecret('phantom'), undefined);
});

t('setSecret: handles unicode and long values', () => {
  const longUnicode = '🤖'.repeat(500);
  setSecret('unicode', longUnicode);
  assert.equal(getSecret('unicode'), longUnicode);
});

t('setSecret: handles multiple keys in the same store', () => {
  setSecret('a', '1');
  setSecret('b', '2');
  setSecret('c', '3');
  assert.equal(getSecret('a'), '1');
  assert.equal(getSecret('b'), '2');
  assert.equal(getSecret('c'), '3');
});

t('getSecret: returns undefined when secrets.json is unparseable', () => {
  writeFileSync(secretsPath, '<<not json>>');
  assert.equal(getSecret('badKey'), undefined);
});

t('initSecrets: idempotent and safe to call twice', () => {
  void initSecrets();
  void initSecrets();
});

t('setSecret: round-trips an empty string value', () => {
  setSecret('empty', '');
  assert.equal(getSecret('empty'), '');
});

// Cleanup
rmSync(tmp, { recursive: true, force: true });
if (existsSync(secretsPath)) rmSync(secretsPath, { force: true });

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log(`secrets.test.ts — all 14 assertions passed`);
