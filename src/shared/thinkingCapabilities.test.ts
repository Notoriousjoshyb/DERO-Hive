import assert from 'node:assert/strict';
import {
  thinkingOptionsFor,
  usesDefaultThinkingOptions,
  supportsOpenAIReasoningEffort,
  supportsAnthropicExtendedThinking,
  anthropicThinkingBudget
} from './thinkingCapabilities';

// ─── thinkingOptionsFor ───────────────────────────────────────────────────

// codex with metadata
const codexOpts = thinkingOptionsFor('codex', 'codex-model', {
  supportsReasoning: true,
  thinkingOptions: [{ id: 'low', label: 'Low', description: 'Brief' }]
});
assert.equal(codexOpts.length, 1);

// codex without metadata falls back to defaults
const codexDefault = thinkingOptionsFor('codex', 'codex-model', undefined);
assert.equal(codexDefault.length, 3);

// anthropic — supported model
const anthroOpts = thinkingOptionsFor('anthropic', 'claude-sonnet-4');
assert.equal(anthroOpts.length, 3);
assert.equal(anthroOpts[0].id, 'low');

// anthropic — unsupported model (claude 3)
const oldAnthro = thinkingOptionsFor('anthropic', 'claude-3-sonnet');
assert.equal(oldAnthro.length, 0);

// anthropic — haiku-4.5 supported
const haikuOpts = thinkingOptionsFor('anthropic', 'claude-haiku-4.5');
assert.equal(haikuOpts.length, 3);

// openai — o-series supported
const oaiOpts = thinkingOptionsFor('openai', 'o3');
assert.equal(oaiOpts.length, 3);
assert.equal(oaiOpts[0].id, 'low');

// openai — gpt-5 (bare)
const gpt5Bare = thinkingOptionsFor('openai', 'gpt-5');
assert.equal(gpt5Bare.length, 4); // includes minimal
assert.ok(gpt5Bare.some((o) => o.id === 'minimal'));

// openai — gpt-5.2 (xhigh)
const gpt52 = thinkingOptionsFor('openai', 'gpt-5.2');
assert.equal(gpt52.length, 4); // low, medium, high, xhigh
assert.ok(gpt52.some((o) => o.id === 'xhigh'));

// openai — gpt-5-pro (no efforts)
const gpt5Pro = thinkingOptionsFor('openai', 'gpt-5.2-pro');
assert.equal(gpt5Pro.length, 0);

// openai — unsupported
const gpt4 = thinkingOptionsFor('openai', 'gpt-4');
assert.equal(gpt4.length, 0);

// default (other providers)
const defaultOpts = thinkingOptionsFor('minimax', 'MiniMax-M3');
assert.equal(defaultOpts.length, 3);
assert.equal(defaultOpts[0].id, 'low');

// undefined preset
const undefOpts = thinkingOptionsFor(undefined, 'some-model');
assert.equal(undefOpts.length, 3);

// ─── usesDefaultThinkingOptions ───────────────────────────────────────────

assert.equal(usesDefaultThinkingOptions('codex', 'x', { thinkingOptions: [{ id: 'low', label: 'Low', description: 'B' }] }), false);
assert.equal(usesDefaultThinkingOptions('codex', 'x', undefined), true);
assert.equal(usesDefaultThinkingOptions('anthropic', 'claude-sonnet-4', undefined), false);
assert.equal(usesDefaultThinkingOptions('anthropic', 'claude-3-sonnet', undefined), true);
assert.equal(usesDefaultThinkingOptions('openai', 'o3', undefined), false);
assert.equal(usesDefaultThinkingOptions('openai', 'gpt-4', undefined), true);
assert.equal(usesDefaultThinkingOptions('minimax', 'x', undefined), true);

// ─── supportsOpenAIReasoningEffort ────────────────────────────────────────

assert.equal(supportsOpenAIReasoningEffort('openai', 'o3'), true);
assert.equal(supportsOpenAIReasoningEffort('openai', 'gpt-4'), false);
assert.equal(supportsOpenAIReasoningEffort('anthropic', 'claude-sonnet-4'), false);

// ─── supportsAnthropicExtendedThinking ────────────────────────────────────

assert.equal(supportsAnthropicExtendedThinking('anthropic', 'claude-sonnet-4'), true);
assert.equal(supportsAnthropicExtendedThinking('anthropic', 'claude-3-5-sonnet'), false);
assert.equal(supportsAnthropicExtendedThinking('openai', 'gpt-4'), false);

// ─── anthropicThinkingBudget ──────────────────────────────────────────────

assert.equal(anthropicThinkingBudget('low'), 1_024);
assert.equal(anthropicThinkingBudget('medium'), 4_096);
assert.equal(anthropicThinkingBudget('high'), 8_192);
assert.equal(anthropicThinkingBudget('xhigh'), 8_192); // falls through to default (high)

console.log('thinkingCapabilities tests passed');
