import assert from 'node:assert/strict';
import { classifyProviderError, toHiveError } from './errors';

// ─── classifyProviderError ────────────────────────────────────────────────

// 429 with a Retry-After hint → rate_limit, retriable, delay parsed
{
  const info = classifyProviderError({ status: 429, message: 'Rate limit exceeded, retry-after: 7', providerId: 'openai', model: 'gpt-4o' });
  assert.equal(info.category, 'provider');
  assert.equal(info.kind, 'rate_limit');
  assert.equal(info.retriable, true);
  assert.equal(info.retryAfterMs, 7000);
  assert.equal(info.providerId, 'openai');
  assert.equal(info.model, 'gpt-4o');
  assert.equal(info.message, 'Rate limit exceeded, retry-after: 7');
}

// 429 without a hint → no retryAfterMs
{
  const info = classifyProviderError({ status: 429 });
  assert.equal(info.kind, 'rate_limit');
  assert.equal(info.retriable, true);
  assert.equal(info.retryAfterMs, undefined);
}

// message-only rate limit (no status)
{
  const info = classifyProviderError({ message: '429 Too Many Requests' });
  assert.equal(info.kind, 'rate_limit');
  assert.equal(info.retriable, true);
}

// 401 / 403 → auth, not retriable
{
  const info = classifyProviderError({ status: 401, message: 'Invalid API key provided' });
  assert.equal(info.kind, 'auth');
  assert.equal(info.retriable, false);
}
{
  const info = classifyProviderError({ status: 403, message: 'Forbidden' });
  assert.equal(info.kind, 'auth');
  assert.equal(info.retriable, false);
}

// 402 and quota-ish bodies → quota, not retriable
{
  const info = classifyProviderError({ status: 402, message: 'Payment required' });
  assert.equal(info.kind, 'quota');
  assert.equal(info.retriable, false);
}
{
  const info = classifyProviderError({ status: 429, message: 'You exceeded your current quota, please check your plan and billing details' });
  // status 429 wins over body keywords: providers reuse 429 for both
  assert.equal(info.kind, 'rate_limit');
}
{
  const info = classifyProviderError({ status: 400, message: 'insufficient user quota' });
  assert.equal(info.kind, 'quota');
  assert.equal(info.retriable, false);
}

// 529 / 503 / 502 and overloaded bodies → overloaded, retriable
{
  const info = classifyProviderError({ status: 529, message: 'Overloaded' });
  assert.equal(info.kind, 'overloaded');
  assert.equal(info.retriable, true);
}
{
  const info = classifyProviderError({ status: 503, message: 'Service Unavailable' });
  assert.equal(info.kind, 'overloaded');
  assert.equal(info.retriable, true);
}
{
  const info = classifyProviderError({ message: 'the model is currently overloaded, please try again later' });
  assert.equal(info.kind, 'overloaded');
  assert.equal(info.retriable, true);
}

// network codes and fetch failures → network, retriable
for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']) {
  const info = classifyProviderError({ code, message: `request failed: ${code}` });
  assert.equal(info.kind, 'network', code);
  assert.equal(info.retriable, true, code);
}
{
  const info = classifyProviderError({ message: 'fetch failed' });
  assert.equal(info.kind, 'network');
  assert.equal(info.retriable, true);
}

// 400 / 404 / 422 and invalid bodies → invalid_request, not retriable
{
  const info = classifyProviderError({ status: 400, message: 'messages: field required' });
  assert.equal(info.kind, 'invalid_request');
  assert.equal(info.retriable, false);
}
{
  const info = classifyProviderError({ status: 404, message: 'model not found' });
  assert.equal(info.kind, 'invalid_request');
  assert.equal(info.retriable, false);
}
{
  const info = classifyProviderError({ status: 422, message: 'Unprocessable Entity' });
  assert.equal(info.kind, 'invalid_request');
  assert.equal(info.retriable, false);
}

// anything else → unknown, not retriable
{
  const info = classifyProviderError({ status: 500, message: 'something broke' });
  assert.equal(info.kind, 'unknown');
  assert.equal(info.retriable, false);
}

// ─── toHiveError ──────────────────────────────────────────────────────────

// Error objects carry status/code; ctx wins when both are present
{
  const err = Object.assign(new Error('Request failed with status code 401'), { status: 401 });
  const info = toHiveError(err, { providerId: 'anthropic', model: 'claude-sonnet-4' });
  assert.equal(info.kind, 'auth');
  assert.equal(info.retriable, false);
  assert.equal(info.providerId, 'anthropic');
  assert.equal(info.model, 'claude-sonnet-4');
  assert.equal(info.message, 'Request failed with status code 401');
}
{
  const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const info = toHiveError(err);
  assert.equal(info.kind, 'network');
  assert.equal(info.retriable, true);
}

// unknown string error → unknown, message preserved
{
  const info = toHiveError('totally unexpected string failure');
  assert.equal(info.category, 'provider');
  assert.equal(info.kind, 'unknown');
  assert.equal(info.retriable, false);
  assert.equal(info.message, 'totally unexpected string failure');
}

// non-Error, non-string values still classify
{
  const info = toHiveError({ weird: true });
  assert.equal(info.kind, 'unknown');
  assert.equal(info.retriable, false);
  assert.equal(typeof info.message, 'string');
}

console.log('errors classify tests passed');
