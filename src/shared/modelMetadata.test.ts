import assert from 'node:assert/strict';
import { getModelMetadata, applyKnownMetadata, mediaKindsForModel } from './modelMetadata';

// ─── getModelMetadata ─────────────────────────────────────────────────────

const gpt55 = getModelMetadata('gpt-5.5');
assert.notEqual(gpt55, null);
assert.equal(gpt55!.contextWindow, 1_050_000);
assert.equal(gpt55!.supportsVision, true);

// normalized match
const claudeNormalized = getModelMetadata('claude-sonnet-4-5');
assert.notEqual(claudeNormalized, null);
assert.ok(claudeNormalized!.supportsReasoning);

// Ollama family match
const ollama = getModelMetadata('llama3.2:latest');
assert.notEqual(ollama, null);
assert.equal(ollama!.contextWindow, 128_000);

// free-tier suffix stripped
const free = getModelMetadata('deepseek-v4-flash-free');
assert.notEqual(free, null);
assert.equal(free!.maxOutput, 65_536);

// :free suffix
const qwenFree = getModelMetadata('qwen3.7-max:free');
assert.notEqual(qwenFree, null);
assert.equal(qwenFree!.contextWindow, 1_000_000);

// unknown model
const unknown = getModelMetadata('nonexistent-model-v99');
assert.equal(unknown, null);

// OpenRouter-prefixed
const orModel = getModelMetadata('anthropic/claude-sonnet-4.5');
assert.notEqual(orModel, null);
assert.ok(orModel!.supportsTools);

// ─── applyKnownMetadata ───────────────────────────────────────────────────

const input: Parameters<typeof applyKnownMetadata>[0] = [{ id: 'gpt-5.5', name: 'GPT-5.5' }];
const applied = applyKnownMetadata(input);
assert.equal(applied.length, 1);
assert.equal(applied[0].contextWindow, 1_050_000);
assert.equal(applied[0].maxOutput, 128_000);

// existing values are NOT overridden
const withExisting = applyKnownMetadata([{ id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 999 }]);
assert.equal(withExisting[0].contextWindow, 999);

// unknown model gets no metadata applied
const unknownInput = [{ id: 'unknown-model', name: '?' }];
const unknownApplied = applyKnownMetadata(unknownInput);
assert.equal(unknownApplied[0].contextWindow, undefined);

// empty input
const emptyApplied = applyKnownMetadata([]);
assert.equal(emptyApplied.length, 0);

// media kinds preserved from input
const withMedia = applyKnownMetadata([{ id: 'dall-e-3', name: 'DALL-E', mediaKinds: ['image'] }]);
assert.deepEqual(withMedia[0].mediaKinds, ['image']);

// ─── mediaKindsForModel ───────────────────────────────────────────────────

assert.deepEqual(mediaKindsForModel('minimax/video-01'), ['video']);
assert.deepEqual(mediaKindsForModel('gpt-4o'), []); // text model
assert.deepEqual(mediaKindsForModel('tts-1'), ['audio']);
assert.deepEqual(mediaKindsForModel('flux'), ['image']);
assert.deepEqual(mediaKindsForModel('whisper-1'), []); // input, not generation
assert.deepEqual(mediaKindsForModel('musicgen'), ['audio']);
assert.deepEqual(mediaKindsForModel(''), []);

// case-insensitive
assert.deepEqual(mediaKindsForModel('DALL-E-3'), ['image']);

console.log('modelMetadata tests passed');
