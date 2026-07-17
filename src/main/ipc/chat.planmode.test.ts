import assert from 'node:assert/strict';
import type { ToolDefinition } from '../../shared/types';
import { classifyProviderError } from '../../shared/errors';
import { filterPlanSafeTools, shouldAbortFallbackChain, retryDelayForError } from './chat';

// ─── filterPlanSafeTools ────────────────────────────────────────────────────

function tool(name: string, source: ToolDefinition['source'] = 'builtin'): ToolDefinition {
  return { name, description: `${name} tool`, parameters: {}, source };
}

// The CLI's read-only safe set is kept, in order
{
  const all = [
    tool('read_file'),
    tool('list_directory'),
    tool('glob_files'),
    tool('grep_files'),
    tool('lint_dvm_basic'),
    tool('get_simulator_chain_info')
  ];
  const filtered = filterPlanSafeTools(all);
  assert.deepEqual(filtered.map((t) => t.name), all.map((t) => t.name));
}

// Mutating, shell, and media tools are dropped
{
  const filtered = filterPlanSafeTools([
    tool('read_file'),
    tool('write_file'),
    tool('edit_file'),
    tool('run_shell'),
    tool('generate_image'),
    tool('generate_video'),
    tool('glob_files')
  ]);
  assert.deepEqual(filtered.map((t) => t.name), ['read_file', 'glob_files']);
}

// MCP tools are never plan-safe — even when the name matches a safe builtin
{
  const filtered = filterPlanSafeTools([
    tool('read_file', 'mcp:obsidian'),
    tool('vault_search', 'mcp:obsidian'),
    tool('grep_files')
  ]);
  assert.deepEqual(filtered.map((t) => t.name), ['grep_files']);
}

// Empty input stays empty; non-plan callers are unaffected (pure function)
{
  assert.deepEqual(filterPlanSafeTools([]), []);
}

// ─── shouldAbortFallbackChain ───────────────────────────────────────────────

const openai = { providerId: 'openai', model: 'gpt-4o' };
const openaiAlt = { providerId: 'openai', model: 'gpt-4o-mini' };
const anthropic = { providerId: 'anthropic', model: 'claude-sonnet-4-5' };

// auth / quota are provider-scoped: the next hop on the SAME provider would
// fail identically, so abort rather than mask the credential/billing problem
for (const [input, expected] of [
  [{ status: 401, message: 'Invalid API key' }, 'auth'],
  [{ status: 402, message: 'Payment required' }, 'quota']
] as const) {
  const info = classifyProviderError(input);
  assert.equal(info.kind, expected);
  assert.equal(shouldAbortFallbackChain(info, openai, openaiAlt), true, expected);
  // ...but a DIFFERENT provider knows nothing about this one's credentials,
  // so the configured fallback must still be tried.
  assert.equal(shouldAbortFallbackChain(info, openai, anthropic), false, expected);
  // No next hop: surface the real error as-is.
  assert.equal(shouldAbortFallbackChain(info, openai, undefined), true, expected);
  assert.equal(shouldAbortFallbackChain(info), true, expected);
}

// invalid_request is target-specific (unknown model id / unsupported params) —
// another target may well accept the same request, even on the same provider
{
  const info = classifyProviderError({ status: 400, message: 'messages: field required' });
  assert.equal(info.kind, 'invalid_request');
  assert.equal(shouldAbortFallbackChain(info, openai, openaiAlt), false);
  assert.equal(shouldAbortFallbackChain(info, openai, anthropic), false);
  assert.equal(shouldAbortFallbackChain(info), false);
}

// rate_limit / overloaded / network / unknown proceed to the next target
for (const [input, expected] of [
  [{ status: 429, message: 'Too Many Requests' }, 'rate_limit'],
  [{ status: 529, message: 'Overloaded' }, 'overloaded'],
  [{ code: 'ECONNRESET', message: 'socket hang up' }, 'network'],
  [{ status: 500, message: 'something broke' }, 'unknown']
] as const) {
  const info = classifyProviderError(input);
  assert.equal(info.kind, expected);
  assert.equal(shouldAbortFallbackChain(info, openai, openaiAlt), false, expected);
  assert.equal(shouldAbortFallbackChain(info, openai, anthropic), false, expected);
}

// ─── retryDelayForError ─────────────────────────────────────────────────────

// rate_limit honors the provider's Retry-After hint
{
  const info = classifyProviderError({ status: 429, message: 'Rate limit exceeded, retry-after: 7' });
  assert.equal(info.retryAfterMs, 7000);
  assert.equal(retryDelayForError(info, 1), 7000);
  assert.equal(retryDelayForError(info, 2), 7000);
}

// the hint is capped at 60s so a bad hint cannot stall a turn
{
  const info = classifyProviderError({ status: 429, message: 'Rate limit exceeded, retry-after: 300' });
  assert.equal(info.retryAfterMs, 300_000);
  assert.equal(retryDelayForError(info, 1), 60_000);
}

// rate_limit without a hint falls back to linear backoff
{
  const info = classifyProviderError({ status: 429 });
  assert.equal(retryDelayForError(info, 1), 800);
  assert.equal(retryDelayForError(info, 2), 1600);
}

// non-rate-limit errors always use linear backoff
{
  const info = classifyProviderError({ code: 'ECONNRESET', message: 'socket hang up' });
  assert.equal(retryDelayForError(info, 2), 1600);
  assert.equal(retryDelayForError(info, 2, 500), 1000);
}

console.log('chat plan-mode + fallback decision tests passed');
