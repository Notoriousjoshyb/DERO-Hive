import assert from 'node:assert/strict';
import { anthropicCachedTokens } from './anthropic';
import { openAICachedTokens } from './openai-compatible';

// ─── anthropicCachedTokens ────────────────────────────────────────────────

// cache read + cache creation are summed
assert.equal(anthropicCachedTokens({ cache_read_input_tokens: 1200, cache_creation_input_tokens: 300 }), 1500);

// either counter alone works
assert.equal(anthropicCachedTokens({ cache_read_input_tokens: 500 }), 500);
assert.equal(anthropicCachedTokens({ cache_creation_input_tokens: 700 }), 700);

// no cache fields → undefined (field stays absent on TokenUsage)
assert.equal(anthropicCachedTokens({}), undefined);

// explicit zeros → undefined, not a misleading 0
assert.equal(anthropicCachedTokens({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);

// ─── openAICachedTokens ───────────────────────────────────────────────────

// OpenAI shape: prompt_tokens_details.cached_tokens
assert.equal(openAICachedTokens({ prompt_tokens_details: { cached_tokens: 640 } }), 640);

// DeepSeek shape: prompt_cache_hit_tokens when prompt_tokens_details is absent
assert.equal(openAICachedTokens({ prompt_cache_hit_tokens: 256, prompt_cache_miss_tokens: 744 }), 256);

// prompt_tokens_details wins when both are present
assert.equal(openAICachedTokens({ prompt_tokens_details: { cached_tokens: 10 }, prompt_cache_hit_tokens: 999 }), 10);

// details present but zero → falls back to the DeepSeek counter
assert.equal(openAICachedTokens({ prompt_tokens_details: { cached_tokens: 0 }, prompt_cache_hit_tokens: 42 }), 42);

// nothing reported → undefined
assert.equal(openAICachedTokens({}), undefined);
assert.equal(openAICachedTokens({ prompt_tokens_details: null }), undefined);
assert.equal(openAICachedTokens({ prompt_tokens_details: {} }), undefined);

// explicit zeros → undefined, not a misleading 0
assert.equal(openAICachedTokens({ prompt_tokens_details: { cached_tokens: 0 } }), undefined);
assert.equal(openAICachedTokens({ prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 900 }), undefined);

// garbage (non-number) values are ignored
assert.equal(openAICachedTokens({ prompt_tokens_details: { cached_tokens: '100' as unknown as number } }), undefined);
assert.equal(openAICachedTokens({ prompt_cache_hit_tokens: 'x' as unknown as number }), undefined);

console.log('cached-token usage tests passed');
