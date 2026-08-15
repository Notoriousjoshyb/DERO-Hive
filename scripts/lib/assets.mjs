// Shared helpers for the setup-* scripts that fetch bundled binaries and models.
//
// Every managed asset gets a manifest recording exactly what landed on disk:
// the resolved version, the asset name, its sha256 and byte count, and when it
// was installed. That buys three things the scripts did not have before:
//
//   1. Integrity — a truncated or tampered download is detected, not cached.
//   2. Idempotence that means something — "already present" now verifies the
//      bytes instead of trusting a filename and a size floor.
//   3. Reproducibility — you can see what a given machine actually installed.
//
// The pattern (manifest per asset, sha256 + install timestamp, prebuilt-info
// alongside the payload) is borrowed from Unsloth Studio's bundled-runtime
// layout — see HARNESS_INTEGRATION_PLAN.md §3.1.
//
// Set HIVE_SKIP_ASSETS=1 to skip every download: CI does this so it never
// pulls a ~150 MB model to run typecheck and unit tests.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MANIFEST_SCHEMA_VERSION = 1;

/** True when the caller asked for no network fetches (CI, offline installs). */
export function skipAssets() {
  const v = process.env.HIVE_SKIP_ASSETS;
  return v === '1' || v === 'true';
}

/** sha256 of a file, streamed so a multi-hundred-MB model is not buffered. */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function readManifest(manifestPath) {
  try {
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    // A corrupt manifest means "unknown", which forces a re-verify.
    return null;
  }
}

export function writeManifest(manifestPath, data) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ schema_version: MANIFEST_SCHEMA_VERSION, ...data }, null, 2) + '\n');
}

/**
 * Is the asset already installed and intact?
 *
 * Returns one of:
 *   { ok: true,  reason }                    — present and verified, skip work
 *   { ok: false, reason, stale: boolean }    — missing, changed, or corrupt
 *
 * `pinnedSha256` is the repo's assertion about what the asset SHOULD be. When
 * absent we fall back to the manifest's recorded hash (trust-on-first-use):
 * that still detects later corruption and still records what was installed,
 * it just cannot detect a bad first download. The two are kept as separate
 * fields so an observed hash is never mistaken for a pin.
 */
export async function verifyInstalled(dest, manifestPath, { pinnedSha256, minBytes = 0 } = {}) {
  if (!existsSync(dest)) return { ok: false, reason: 'not installed', stale: false };

  const size = statSync(dest).size;
  if (minBytes && size < minBytes) return { ok: false, reason: `file too small (${size} bytes)`, stale: true };

  const manifest = readManifest(manifestPath);
  const expected = pinnedSha256 || manifest?.sha256;
  if (!expected) return { ok: false, reason: 'no manifest — hashing to record one', stale: false };

  const actual = await sha256File(dest);
  if (actual !== expected) {
    return {
      ok: false,
      stale: true,
      reason: pinnedSha256
        ? `sha256 mismatch (expected the pinned ${short(expected)}, found ${short(actual)})`
        : `sha256 changed since install (${short(expected)} → ${short(actual)})`
    };
  }
  return { ok: true, reason: `verified ${short(actual)}` };
}

/**
 * Record what landed. Hashes the file, enforces a pin if one was supplied, and
 * writes the manifest. Throws (after removing the file) on a pin mismatch, so a
 * bad download is never left behind to be trusted by the next run.
 */
export async function recordInstalled(dest, manifestPath, { kind, version, asset, url, pinnedSha256, extra = {} }) {
  const sha256 = await sha256File(dest);
  if (pinnedSha256 && sha256 !== pinnedSha256) {
    rmSync(dest, { force: true });
    throw new Error(`sha256 mismatch for ${asset}: expected ${pinnedSha256}, got ${sha256} (file removed)`);
  }
  writeManifest(manifestPath, {
    kind,
    version,
    asset,
    url,
    sha256,
    pinned_sha256: pinnedSha256 || null,
    bytes: statSync(dest).size,
    platform: `${process.platform}-${process.arch}`,
    installed_at_utc: new Date().toISOString()
  });
  return sha256;
}

function short(hash) {
  return typeof hash === 'string' ? hash.slice(0, 12) : String(hash);
}
