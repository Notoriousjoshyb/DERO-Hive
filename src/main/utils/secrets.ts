import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { paths } from './paths';
import { app } from 'electron';
import { logger } from './logger';

// Encrypted key store. Uses machine-derived key (safe enough for API keys;
// for true at-rest security use OS keychain on macOS/Linux, DPAPI on Windows).
let machineKey: Buffer | null = null;

function getMachineKey(): Buffer {
  if (machineKey) return machineKey;
  // Mix multiple machine identifiers with a salt, then scrypt
  const seed = [
    process.platform,
    process.arch,
    process.env.USERNAME || process.env.USER || 'anon',
    process.env.COMPUTERNAME || 'unknown',
    app.getPath('userData')
  ].join('|');
  const salt = Buffer.from('hive-secrets-v1', 'utf-8');
  machineKey = scryptSync(seed, salt, 32);
  return machineKey;
}

interface SecretStore {
  [key: string]: string; // key -> base64 ciphertext (iv|ciphertext)
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

export async function initSecrets(): Promise<void> {
  // Touch machine key
  getMachineKey();
  logger.debug('secrets', 'initialized');
}

export function setSecret(key: string, value: string): void {
  const store = loadStore();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', getMachineKey(), iv);
  const enc = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  store[key] = [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  saveStore(store);
}

export function getSecret(key: string): string | undefined {
  const store = loadStore();
  const raw = store[key];
  if (!raw) return undefined;
  try {
    const [ivB64, tagB64, encB64] = raw.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', getMachineKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8');
  } catch (err) {
    logger.error('secrets', `failed to decrypt ${key}`, err);
    return undefined;
  }
}

export function deleteSecret(key: string): void {
  const store = loadStore();
  delete store[key];
  saveStore(store);
}