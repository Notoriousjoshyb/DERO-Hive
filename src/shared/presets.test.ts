import assert from 'node:assert/strict';
import { findPreset, PROVIDER_PRESETS } from './presets';

// ─── findPreset ───────────────────────────────────────────────────────────

const openai = findPreset('openai');
assert.notEqual(openai, undefined);
assert.equal(openai!.name, 'OpenAI');
assert.equal(openai!.baseUrl, 'https://api.openai.com/v1');
assert.equal(openai!.defaultModel, 'gpt-4o-mini');

const anthropic = findPreset('anthropic');
assert.notEqual(anthropic, undefined);
assert.equal(anthropic!.defaultModel, 'claude-sonnet-4-5');
assert.equal(anthropic!.supportsReasoning, true);

const ollama = findPreset('ollama');
assert.notEqual(ollama, undefined);
assert.equal(ollama!.baseUrl, 'http://localhost:11434/v1');

const missing = findPreset('nonexistent');
assert.equal(missing, undefined);

const codex = findPreset('codex');
assert.notEqual(codex, undefined);
assert.equal(codex!.id, 'codex');

// ─── PROVIDER_PRESETS — sanity ────────────────────────────────────────────

assert.ok(PROVIDER_PRESETS.length >= 10);
assert.ok(PROVIDER_PRESETS.every((p) => p.id && p.name && p.baseUrl !== undefined));
assert.ok(new Set(PROVIDER_PRESETS.map((p) => p.id)).size === PROVIDER_PRESETS.length);

console.log('presets tests passed');
