import { strict as assert } from 'node:assert';
import type { ProviderConfig, ProviderFallback } from '../../../src/shared/types.js';
import { resolveProviderChain } from './chat.js';

let failures = 0;
function t(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${(e as Error).message}`); }
}

const providers: ProviderConfig[] = [
  {
    id: 'openai', name: 'OpenAI', enabled: true, baseUrl: '',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128000, supportsTools: true, supportsVision: false },
      { id: 'gpt-3.5', label: 'GPT-3.5', contextWindow: 16000, supportsTools: false, supportsVision: false }
    ]
  },
  {
    id: 'anthropic', name: 'Anthropic', enabled: true, baseUrl: '',
    models: [
      { id: 'claude-3', label: 'Claude 3', contextWindow: 200000, supportsTools: true, supportsVision: true }
    ]
  },
  {
    id: 'disabled', name: 'Disabled', enabled: false, baseUrl: '',
    models: [{ id: 'm', label: 'M', contextWindow: 1, supportsTools: false, supportsVision: false }]
  }
];

// ── happy paths ───────────────────────────────────────────────────
t('primary only → one target', () => {
  const r = resolveProviderChain(
    { providerId: 'openai', model: 'gpt-4o' },
    undefined,
    providers
  );
  assert.equal(r.targets.length, 1);
  assert.equal(r.targets[0].providerId, 'openai');
  assert.equal(r.targets[0].model, 'gpt-4o');
  assert.equal(r.unavailable.length, 0);
});

t('primary + array fallbacks → three targets', () => {
  const r = resolveProviderChain(
    { providerId: 'openai', model: 'gpt-4o' },
    [
      { providerId: 'anthropic', model: 'claude-3' },
      { providerId: 'openai', model: 'gpt-3.5' }
    ],
    providers
  );
  assert.equal(r.targets.length, 3);
  assert.deepEqual(r.targets.map((t) => t.providerId), ['openai', 'anthropic', 'openai']);
});

t('falls back to first available when primary missing', () => {
  const r = resolveProviderChain(
    { providerId: 'unknown', model: 'x' },
    [{ providerId: 'openai', model: 'gpt-4o' }],
    providers
  );
  assert.equal(r.targets.length, 1);
  assert.equal(r.targets[0].providerId, 'openai');
  assert.equal(r.unavailable.length, 1);
});

t('disabled providers skipped even if listed', () => {
  const r = resolveProviderChain(
    { providerId: 'openai', model: 'gpt-4o' },
    [{ providerId: 'disabled', model: 'm' }],
    providers
  );
  assert.equal(r.targets.length, 1);
  assert.equal(r.targets[0].providerId, 'openai');
  assert.equal(r.unavailable.some((s) => s.includes('disabled')), true);
});

t('deduplicates same provider+model across refs', () => {
  const r = resolveProviderChain(
    { providerId: 'openai', model: 'gpt-4o' },
    [{ providerId: 'openai', model: 'gpt-4o' }],
    providers
  );
  assert.equal(r.targets.length, 1);
});

// ── unavailable messages ──────────────────────────────────────────
t('unknown provider produces clear error', () => {
  const r = resolveProviderChain({ providerId: 'missing', model: 'x' }, undefined, providers);
  assert.equal(r.unavailable.length, 1);
  assert.ok(r.unavailable[0].includes('missing'));
});

t('known provider + unknown model produces clear error', () => {
  const r = resolveProviderChain({ providerId: 'openai', model: 'no-such-model' }, undefined, providers);
  assert.equal(r.unavailable.length, 1);
  assert.ok(r.unavailable[0].includes('no-such-model'));
  assert.ok(r.unavailable[0].includes('OpenAI'));
});

t('primary unavailable + fallback missing → both flagged', () => {
  const r = resolveProviderChain(
    { providerId: 'missing1', model: 'a' },
    [{ providerId: 'missing2', model: 'b' }],
    providers
  );
  assert.equal(r.targets.length, 0);
  assert.equal(r.unavailable.length, 2);
});

// ── fallback parsing ──────────────────────────────────────────────
t('non-array fallbackValue is ignored', () => {
  const r = resolveProviderChain(
    { providerId: 'openai', model: 'gpt-4o' },
    'just a string',
    providers
  );
  assert.equal(r.targets.length, 1);
});

t('malformed entries skipped within array', () => {
  const r = resolveProviderChain(
    { providerId: 'openai', model: 'gpt-4o' },
    [null, 'string', { providerId: 'anthropic', model: 'claude-3' }, { providerId: 42 as unknown as string, model: 'x' }, { providerId: 'anthropic', model: undefined }],
    providers
  );
  assert.equal(r.targets.length, 2);
  assert.equal(r.targets[1].providerId, 'anthropic');
});

t('primary missing values silently skipped', () => {
  const r = resolveProviderChain(
    { providerId: '', model: '' },
    [{ providerId: 'openai', model: 'gpt-4o' }],
    providers
  );
  assert.equal(r.targets.length, 1);
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall assertions passed');
