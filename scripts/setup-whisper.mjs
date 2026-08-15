#!/usr/bin/env node
// Downloads the Whisper.cpp model used for local speech-to-text.
// Runs automatically on `npm install` (postinstall) and is idempotent — it
// skips the download if the model already exists. The model is intentionally
// NOT committed to the repo to keep it lean.
//
// Override the model with WHISPER_MODEL, e.g.:
//   WHISPER_MODEL=ggml-small.en.bin npm run setup:whisper
//
// Available models: https://huggingface.co/ggerganov/whisper.cpp

import { existsSync, mkdirSync, statSync, createWriteStream, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { skipAssets, verifyInstalled, recordInstalled } from './lib/assets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(__dirname, '..', 'resources', 'whisper', 'models');
const MODEL = process.env.WHISPER_MODEL || 'ggml-base.en.bin';
const URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}`;
const MIN_BYTES = 10 * 1024 * 1024; // sanity floor — real models are >30MB

// Upstream publishes no checksum alongside these files, so there is no pin to
// assert. The manifest records the hash observed on first download, which
// still catches later truncation or corruption — see scripts/lib/assets.mjs.
const PINNED_SHA256 = null;

async function main() {
  const dest = join(modelsDir, MODEL);
  const manifestPath = join(modelsDir, `${MODEL}.manifest.json`);

  if (skipAssets()) {
    console.log(`[whisper] HIVE_SKIP_ASSETS set — skipping ${MODEL}${existsSync(dest) ? ' (already present)' : ''}`);
    return;
  }

  const check = await verifyInstalled(dest, manifestPath, { pinnedSha256: PINNED_SHA256, minBytes: MIN_BYTES });
  if (check.ok) {
    console.log(`[whisper] model present: ${MODEL} (${mb(statSync(dest).size)}) — ${check.reason}`);
    return;
  }
  if (existsSync(dest) && check.stale) {
    console.warn(`[whisper] re-downloading: ${check.reason}`);
    rmSync(dest, { force: true });
  } else if (existsSync(dest)) {
    // Present and the right size, just unrecorded — hash it and move on
    // rather than re-downloading 150 MB to learn what we already have.
    const sha = await recordInstalled(dest, manifestPath, { kind: 'whisper-model', version: MODEL, asset: MODEL, url: URL, pinnedSha256: PINNED_SHA256 });
    console.log(`[whisper] model present: ${MODEL} (${mb(statSync(dest).size)}) — recorded ${sha.slice(0, 12)}`);
    return;
  }

  mkdirSync(modelsDir, { recursive: true });
  console.log(`[whisper] downloading ${MODEL} …`);
  console.log(`[whisper] ${URL}`);

  try {
    await download(URL, dest);
    const size = statSync(dest).size;
    if (size < MIN_BYTES) throw new Error(`downloaded file too small (${size} bytes)`);
    const sha = await recordInstalled(dest, manifestPath, { kind: 'whisper-model', version: MODEL, asset: MODEL, url: URL, pinnedSha256: PINNED_SHA256 });
    console.log(`[whisper] done — ${MODEL} (${mb(size)}) sha256 ${sha.slice(0, 12)}`);
  } catch (err) {
    try { rmSync(dest, { force: true }); } catch { /* ignore */ }
    // Never fail the install — dictation just stays disabled until the model exists.
    console.warn(`[whisper] could not download model: ${err?.message || err}`);
    console.warn('[whisper] Local dictation will be unavailable until a model is present.');
    console.warn(`[whisper] Fetch it manually into resources/whisper/models/ from:`);
    console.warn(`[whisper]   ${URL}`);
  }
}

async function download(url, dest, redirects = 0) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    if ((res.status === 301 || res.status === 302) && redirects < 5) {
      const loc = res.headers.get('location');
      if (loc) return download(loc, dest, redirects + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastPct = -1;
  const file = createWriteStream(dest);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      await new Promise((resolve, reject) =>
        file.write(Buffer.from(value), (e) => (e ? reject(e) : resolve()))
      );
      if (total) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          process.stdout.write(`\r[whisper] ${pct}% (${mb(received)} / ${mb(total)})   `);
          lastPct = pct;
        }
      }
    }
  } finally {
    file.close();
    if (total) process.stdout.write('\n');
  }
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main();
