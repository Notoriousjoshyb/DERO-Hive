import assert from 'node:assert/strict';
import { namespacedToolName, slugifyServer, assignUniqueNames, isNamespaced, MAX_TOOL_NAME } from './namespace';

// Both Anthropic and OpenAI validate tool names against this.
const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// ── slugs ────────────────────────────────────────────────────────────────
{
  assert.equal(slugifyServer('DERO Daemon'), 'dero_daemon');
  assert.equal(slugifyServer('  weird--name!! '), 'weird_name');
  assert.equal(slugifyServer('!!!'), 'server', 'a name with nothing usable still needs a slug');
}

// ── the advertised name is always provider-legal ─────────────────────────
{
  const cases: Array<[string, string]> = [
    ['DERO Daemon', 'get_sc'],
    ['weird: server/name', 'tool.with.dots'],
    ['x'.repeat(80), 'y'.repeat(20)],
    ['server', 'z'.repeat(70)]
  ];
  for (const [server, tool] of cases) {
    const name = namespacedToolName(server, tool);
    assert.ok(PROVIDER_NAME_RE.test(name), `${name} must match the provider tool-name schema`);
    assert.ok(name.length <= MAX_TOOL_NAME);
    assert.ok(isNamespaced(name));
  }
  assert.equal(namespacedToolName('DERO Daemon', 'get_sc'), 'mcp__dero_daemon__get_sc');
}

// ── the tool half survives; the server half is what gets truncated ───────
{
  const name = namespacedToolName('a-very-long-server-name-indeed-truly', 'read_the_important_thing');
  assert.ok(name.endsWith('__read_the_important_thing'), 'the tool name is what the model reasons about');
  assert.ok(name.length <= MAX_TOOL_NAME);
}

// ── two servers offering the same tool both stay reachable ──────────────
{
  const names = assignUniqueNames([
    { serverName: 'Alpha', toolName: 'search' },
    { serverName: 'Beta', toolName: 'search' }
  ]);
  assert.deepEqual(names, ['mcp__alpha__search', 'mcp__beta__search']);
  assert.equal(new Set(names).size, 2);
}

// ── identical after truncation: suffixed, never dropped ─────────────────
{
  const long = 'server-'.repeat(20);
  const names = assignUniqueNames([
    { serverName: long + 'one', toolName: 'do_the_thing_with_a_long_name' },
    { serverName: long + 'two', toolName: 'do_the_thing_with_a_long_name' }
  ]);
  assert.equal(new Set(names).size, 2, 'a collision must not silently drop a tool');
  for (const n of names) assert.ok(PROVIDER_NAME_RE.test(n), `${n} stays provider-legal after suffixing`);
}

// ── names already taken by another server are respected ─────────────────
{
  const taken = new Set(['mcp__alpha__search']);
  const names = assignUniqueNames([{ serverName: 'Alpha', toolName: 'search' }], taken);
  assert.notEqual(names[0], 'mcp__alpha__search');
  assert.equal(new Set([...taken]).has(names[0]), true, 'the new name is recorded as taken');
}

// ── builtins are never namespaced, so they cannot be shadowed ───────────
{
  assert.equal(isNamespaced('run_shell'), false);
  assert.equal(isNamespaced('mcp__x__run_shell'), true);
}

console.log('namespace.test.ts passed');
