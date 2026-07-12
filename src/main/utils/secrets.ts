import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { paths } from './paths';
import { logger } from './logger';

// Encrypted key store.
//
// In the Electron app, secrets are sealed with Electron's safeStorage, which is
// bound to the OS credential system (DPAPI on Windows, Keychain on macOS,
// libsecret/kwallet on Linux). In the CLI / headless build, safeStorage is not
// available, so we fall back to the legacy machine-derived key. The legacy key
// is obfuscation, not encryption, so the CLI warns once on startup.
//
// The previous scheme derived an AES key from public machine identifiers
// (platform, arch, username, hostname, userData path) with a static salt. That
// is obfuscation rather than encryption: anyone able to read secrets.json can
// also read those identifiers and reconstruct the key. Values written by that
// scheme are still readable here so existing API keys survive the upgrade, and
// each is re-sealed with safeStorage the first time it is read in Electron.

const LEGACY_PREFIX = 'v1:';
const SAFE_PREFIX = 'v2:';

let machineKey: Buffer | null = null;
let safeStorage: typeof import('electron').safeStorage | undefined;

function loadSafeStorage(): typeof import('electron').safeStorage | undefined {
  if (safeStorage) return safeStorage;
  if (!process.versions.electron) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    safeStorage = electron.safeStorage;
    return safeStorage;
  } catch {
    return undefined;
  }
}

function getMachineKey(): Buffer {
  if (machineKey) return machineKey;
  const seed = [
    process.platform,
    process.arch,
    process.env.USERNAME || process.env.USER || 'anon',
    process.env.COMPUTERNAME || 'unknown',
    paths.userData
  ].join('|');
  const salt = Buffer.from('hive-secrets-v1', 'utf-8');
  machineKey = scryptSync(seed, salt, 32);
  return machineKey;
}

function safeStorageAvailable(): boolean {
  try {
    return loadSafeStorage()?.isEncryptionAvailable() ?? false;
  } catch {
    return false;
  }
}

interface SecretStore {
  [key: string]: string; // key -> "v2:<sealed>" or "v1:<iv:tag:ciphertext>"
}

function loadStore(): SecretStore {
  if (!existsSync(paths.secrets)) return {};
  try {
    return JSON.parse(readFileSync(paths.secrets, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(store: SecretStore): void {
  writeFileSync(paths.secrets, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function legacyEncrypt(value: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', getMachineKey(), iv);
  const enc = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function legacyDecrypt(raw: string): string {
  const [ivB64, tagB64, encB64] = raw.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', getMachineKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8');
}

function encryptValue(value: string): string {
  const ss = loadSafeStorage();
  if (safeStorageAvailable() && ss) {
    return SAFE_PREFIX + ss.encryptString(value).toString('base64');
  }
  return LEGACY_PREFIX + legacyEncrypt(value);
}

/** Decrypt a stored value. Untagged records predate the v1/v2 prefixes and are
 *  read with the legacy scheme. Returns null if the value cannot be read. */
function decryptValue(raw: string): { value: string; legacy: boolean } | null {
  try {
    const ss = loadSafeStorage();
    if (raw.startsWith(SAFE_PREFIX) && ss) {
      return { value: ss.decryptString(Buffer.from(raw.slice(SAFE_PREFIX.length), 'base64')), legacy: false };
    }
    const body = raw.startsWith(LEGACY_PREFIX) ? raw.slice(LEGACY_PREFIX.length) : raw;
    return { value: legacyDecrypt(body), legacy: true };
  } catch {
    return null;
  }
}

export async function initSecrets(): Promise<void> {
  if (safeStorageAvailable()) {
    logger.debug('secrets', 'initialized (OS-backed safeStorage)');
  } else {
    logger.warn('secrets', 'OS keychain unavailable — falling back to a machine-derived key; secrets are obfuscated, not sealed');
  }
}

export function setSecret(key: string, value: string): void {
  const store = loadStore();
  store[key] = encryptValue(value);
  saveStore(store);
}

export function getSecret(key: string): string | undefined {
  const store = loadStore();
  const raw = store[key];
  if (!raw) return undefined;

  const result = decryptValue(raw);
  if (!result) {
    logger.error('secrets', `failed to decrypt ${key}`);
    return undefined;
  }

  // Upgrade legacy records to the OS-backed store on first read.
  if (result.legacy && safeStorageAvailable()) {
    try {
      store[key] = encryptValue(result.value);
      saveStore(store);
      logger.info('secrets', `migrated ${key} to OS-backed storage`);
    } catch (err) {
      logger.warn('secrets', `could not migrate ${key} to OS-backed storage`, err);
    }
  }
  return result.value;
}

export function deleteSecret(key: string): void {
  const store = loadStore();
  delete store[key];
  saveStore(store);
}
