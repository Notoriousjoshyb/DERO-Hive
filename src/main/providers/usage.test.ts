import assert from 'node:assert/strict';
import { anthropicCachedTokens, anthropicPromptTokens } from './anthropic';
import { openAICachedTokens } from './openai-compatible';

// ─── anthropicCachedTokens ────────────────────────────────────────────────

// Only cache READS count as cachedTokens. cache_creation is a cache *write*,
// billed at a premium — counting it would report a write as a cheap hit.
assert.equal(anthropicCachedTokens({ cache_read_input_tokens: 1200, cache_creation_input_tokens: 300 }), 1200);

// a read alone works
assert.equal(anthropicCachedTokens({ cache_read_input_tokens: 500 }), 500);

// a pure cache-write turn read nothing from cache → undefined, not 700
assert.equal(anthropicCachedTokens({ cache_creation_input_tokens: 700 }), undefined);

// no cache fields → undefined (field stays absent on TokenUsage)
assert.equal(anthropicCachedTokens({}), undefined);

// explicit zeros → undefined, not a misleading 0
assert.equal(anthropicCachedTokens({ cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), undefined);

// ─── anthropicPromptTokens ────────────────────────────────────────────────

// Anthropic excludes both cache counters from input_tokens, so the real prompt
// size is the sum — normalized to OpenAI's shape (cachedTokens ⊆ promptTokens).
assert.equal(
  anthropicPromptTokens({ input_tokens: 12, cache_read_input_tokens: 1200, cache_creation_input_tokens: 300 }),
  1512
);

// The first call of a session: a big system prompt written to cache must not
// be lost from the prompt total just because input_tokens is tiny.
assert.equal(anthropicPromptTokens({ input_tokens: 12, cache_creation_input_tokens: 50000 }), 50012);

// cachedTokens never exceeds promptTokens (the OpenAI invariant)
{
  const u = { input_tokens: 12, cache_read_input_tokens: 1200, cache_creation_input_tokens: 300 };
  assert.ok((anthropicCachedTokens(u) ?? 0) <= anthropicPromptTokens(u));
}

// no cache activity → plain input_tokens
assert.equal(anthropicPromptTokens({ input_tokens: 900 }), 900);
assert.equal(anthropicPromptTokens({}), 0);

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
