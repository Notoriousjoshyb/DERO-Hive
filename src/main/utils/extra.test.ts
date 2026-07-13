import { strict as assert } from 'node:assert';

// ─── isMinimaxProvider ────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isMinimaxProvider } = require('../media/manager') as typeof import('../media/manager');

// ─── validateTerminalCwd ──────────────────────────────────────────────
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'hive-extra-'));
process.env.HIVE_DATA_DIR = tmpRoot;
process.env.HIVE_CLI = '1';
process.env.HIVE_WORKSPACE = join(tmpRoot, 'ws');
mkdirSync(process.env.HIVE_WORKSPACE, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateTerminalCwd } = require('../terminal/session') as typeof import('../terminal/session');

let failures = 0;
function t(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

// ── isMinimaxProvider ────────────────────────────────────────────────
t('isMinimaxProvider: true when presetId is exactly "minimax"', () => {
  assert.equal(isMinimaxProvider('minimax'), true);
});

t('isMinimaxProvider: true when baseUrl contains "minimax" (case-insensitive)', () => {
  assert.equal(isMinimaxProvider(undefined, 'https://api.minimax.example/v1'), true);
  assert.equal(isMinimaxProvider(undefined, 'https://MiniMax.dev/'), true);
  assert.equal(isMinimaxProvider(undefined, 'https://MINIMAX.co/'), true);
});

t('isMinimaxProvider: true when both match', () => {
  assert.equal(isMinimaxProvider('minimax', 'https://api.minimax.example'), true);
});

t('isMinimaxProvider: false for unrelated preset + URL', () => {
  assert.equal(isMinimaxProvider('openai', 'https://api.openai.com'), false);
});

t('isMinimaxProvider: false for both undefined', () => {
  assert.equal(isMinimaxProvider(undefined, undefined), false);
});

t('isMinimaxProvider: empty strings treated as no match', () => {
  assert.equal(isMinimaxProvider('', ''), false);
});

// ── validateTerminalCwd ──────────────────────────────────────────────
t('validateTerminalCwd: undefined passes through', () => {
  assert.equal(validateTerminalCwd(undefined), undefined);
});

t('validateTerminalCwd: empty string passes through (treated as "no cwd")', () => {
  assert.equal(validateTerminalCwd(''), '');
});

t('validateTerminalCwd: a relative path inside workspace resolves to workspace root', () => {
  const resolved = validateTerminalCwd('.')!;
  assert.ok(existsSync(resolved), `workspace should exist at ${resolved}`);
  assert.equal(resolved, process.env.HIVE_WORKSPACE);
});

t('validateTerminalCwd: an absolute path inside workspace resolves unchanged', () => {
  const abs = join(process.env.HIVE_WORKSPACE!, 'inside.txt');
  const resolved = validateTerminalCwd(abs)!;
  assert.equal(resolved, abs);
});

t('validateTerminalCwd: an absolute path outside workspace throws', () => {
  let threw = false;
  try {
    validateTerminalCwd(join(tmpRoot, 'sibling.txt'));
  } catch (err) {
    threw = true;
    assert.match((err as Error).message, /outside workspace/i);
  }
  assert.ok(threw, 'expected validateTerminalCwd to throw for an outside path');
});

t('validateTerminalCwd: a relative path that escapes the workspace throws', () => {
  let threw = false;
  try {
    validateTerminalCwd('../escapes');
  } catch (err) {
    threw = true;
    assert.match((err as Error).message, /outside workspace/i);
  }
  assert.ok(threw, 'expected validateTerminalCwd to throw for an escaping relative path');
});

t('validateTerminalCwd: a nested file inside the workspace is allowed', () => {
  const nestedDir = join(process.env.HIVE_WORKSPACE!, 'nested');
  mkdirSync(nestedDir, { recursive: true });
  const nested = join(nestedDir, 'file.txt');
  writeFileSync(nested, 'ok');
  const resolved = validateTerminalCwd(nested)!;
  assert.equal(resolved, nested);
});

t('validateTerminalCwd: a path that resolves to the same dir as the workspace passes', () => {
  const resolved = validateTerminalCwd(process.env.HIVE_WORKSPACE!)!;
  assert.equal(resolved, process.env.HIVE_WORKSPACE);
});

// Cleanup
rmSync(tmpRoot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log(`extra.test.ts — all 13 assertions passed`);
