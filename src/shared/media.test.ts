import assert from 'node:assert/strict';
import { MEDIA_PROVIDER_PRESETS, findMediaPreset } from './media';

// ─── MEDIA_PROVIDER_PRESETS ─────────────────────────────────────────────────

const presetCount = MEDIA_PROVIDER_PRESETS.length;
assert(presetCount > 0, 'MEDIA_PROVIDER_PRESETS must be non-empty');

// Required fields on every preset
for (const preset of MEDIA_PROVIDER_PRESETS) {
  assert(typeof preset.id === 'string' && preset.id.length > 0, `preset missing id`);
  assert(typeof preset.name === 'string' && preset.name.length > 0, `preset missing name`);
  assert(preset.kind === 'image' || preset.kind === 'audio' || preset.kind === 'both', `invalid kind: ${preset.kind}`);
  assert(typeof preset.requiresApiKey === 'boolean', `preset missing requiresApiKey`);
  assert(typeof preset.notes === 'string' && preset.notes.length > 0, `preset missing notes`);
  assert(Array.isArray(preset.models), `preset missing models array`);
  assert(preset.models.length > 0, `preset must have at least one model`);
}

// Unique ids
const ids = MEDIA_PROVIDER_PRESETS.map((p) => p.id);
assert(new Set(ids).size === ids.length, 'duplicate preset ids');

// Every preset has a defaultModel that exists in its models list
for (const preset of MEDIA_PROVIDER_PRESETS) {
  const defaultModel = preset.models.find((m) => m.id === preset.defaultModel);
  assert(defaultModel != null, `defaultModel "${preset.defaultModel}" not in models list for preset "${preset.id}"`);
}

// Every model has required fields
for (const preset of MEDIA_PROVIDER_PRESETS) {
  for (const model of preset.models) {
    assert(typeof model.id === 'string' && model.id.length > 0, `model missing id in preset ${preset.id}`);
    assert(typeof model.label === 'string' && model.label.length > 0, `model missing label in preset ${preset.id}`);
    assert(model.kind === 'image' || model.kind === 'audio' || model.kind === 'video', `invalid model kind: ${model.kind} in preset ${preset.id}`);
  }
}

// Known presets present
const openai = MEDIA_PROVIDER_PRESETS.find((p) => p.id === 'openai-images');
assert(openai != null, 'openai-images preset missing');
assert(openai!.kind === 'image');
assert(openai!.requiresApiKey === true);
assert(openai!.defaultModel === 'dall-e-3');

const stability = MEDIA_PROVIDER_PRESETS.find((p) => p.id === 'stability');
assert(stability != null, 'stability preset missing');
assert(stability!.kind === 'image');

const pollinations = MEDIA_PROVIDER_PRESETS.find((p) => p.id === 'pollinations');
assert(pollinations != null, 'pollinations preset missing');
assert(pollinations!.requiresApiKey === false, 'pollinations should not require an API key');

const replicate = MEDIA_PROVIDER_PRESETS.find((p) => p.id === 'replicate');
assert(replicate != null, 'replicate preset missing');
assert(replicate!.kind === 'both');

const comfyui = MEDIA_PROVIDER_PRESETS.find((p) => p.id === 'comfyui');
assert(comfyui != null, 'comfyui preset missing');
assert(comfyui!.baseUrl === 'http://127.0.0.1:8188', 'comfyui should have loopback baseUrl');

const a1111 = MEDIA_PROVIDER_PRESETS.find((p) => p.id === 'a1111');
assert(a1111 != null, 'a1111 preset missing');
assert(a1111!.baseUrl === 'http://127.0.0.1:7860', 'a1111 should have loopback baseUrl');

// Local presets (comfyui, a1111) do not require API key
assert(comfyui!.requiresApiKey === false, 'comfyui should not require API key');
assert(a1111!.requiresApiKey === false, 'a1111 should not require API key');

// openai-images includes GPT Image 1
const gptImage = openai!.models.find((m) => m.id === 'gpt-image-1');
assert(gptImage != null, 'openai-images should include gpt-image-1');

// pollinations includes flux
const flux = pollinations!.models.find((m) => m.id === 'flux');
assert(flux != null, 'pollinations should include flux model');

// ─── findMediaPreset ─────────────────────────────────────────────────────────

const found = findMediaPreset('openai-images');
assert(found != null, 'findMediaPreset returned undefined for known preset');
assert(found!.id === 'openai-images');
assert(found!.name === 'OpenAI (Images)');

const notFound = findMediaPreset('nonexistent-preset');
assert(notFound === undefined, 'findMediaPreset should return undefined for unknown preset');

// Handles empty string
const empty = findMediaPreset('');
assert(empty === undefined, 'findMediaPreset should return undefined for empty string');

console.log(`media.test.ts — ${presetCount} presets, all assertions passed`);
