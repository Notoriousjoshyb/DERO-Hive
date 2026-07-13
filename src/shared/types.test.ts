import assert from 'node:assert/strict';
import { normalizeKnowledgePath, normalizeProjectConfig, normalizeToolApprovalMode } from './types';

// ─── normalizeKnowledgePath ───────────────────────────────────────────────

assert.equal(normalizeKnowledgePath('docs/notes'), 'docs/notes');
assert.equal(normalizeKnowledgePath('  docs/notes  '), 'docs/notes');
assert.equal(normalizeKnowledgePath('docs\\notes'), 'docs/notes');
assert.throws(() => normalizeKnowledgePath(''), /required/);
assert.equal(normalizeKnowledgePath('', true), '');
assert.throws(() => normalizeKnowledgePath('/absolute'), /vault-relative/);
assert.throws(() => normalizeKnowledgePath('C:\\\\folder'), /vault-relative/);
assert.throws(() => normalizeKnowledgePath('../escape'), /traverse/);
assert.throws(() => normalizeKnowledgePath('path/./here'), /traverse/);
assert.throws(() => normalizeKnowledgePath('path/../here'), /traverse/);
assert.throws(() => normalizeKnowledgePath(42 as any), /string/);
assert.equal(normalizeKnowledgePath('a/b/c'), 'a/b/c');

// ─── normalizeProjectConfig ───────────────────────────────────────────────

assert.deepEqual(normalizeProjectConfig(undefined), {});
assert.deepEqual(normalizeProjectConfig(null), {});

// kind
assert.deepEqual(normalizeProjectConfig({ kind: 'general' }), { kind: 'general' });
assert.deepEqual(normalizeProjectConfig({ kind: 'dero' }), { kind: 'dero' });
assert.throws(() => normalizeProjectConfig({ kind: 'invalid' }), /Invalid project kind/);
assert.throws(() => normalizeProjectConfig(42), /object/);
assert.throws(() => normalizeProjectConfig([]), /object/);

// MCP server IDs
const withMcp = normalizeProjectConfig({ mcpServerIds: ['server-a', 'server-b'] });
assert.deepEqual(withMcp.mcpServerIds, ['server-a', 'server-b']);

// knowledge
const withKnowledge = normalizeProjectConfig({
  knowledge: { provider: 'obsidian', serverId: 'my-server', folder: 'docs' }
});
assert.equal(withKnowledge.knowledge?.serverId, 'my-server');
assert.equal(withKnowledge.knowledge?.folder, 'docs');
assert.throws(() => normalizeProjectConfig({ knowledge: { provider: 'filesystem', serverId: 'x', folder: '' } }), /Only Obsidian/);

// ─── normalizeToolApprovalMode ────────────────────────────────────────────

assert.equal(normalizeToolApprovalMode('always'), 'always');
assert.equal(normalizeToolApprovalMode('session'), 'session');
assert.equal(normalizeToolApprovalMode('never'), 'never');
assert.equal(normalizeToolApprovalMode('invalid' as any), 'always');
assert.equal(normalizeToolApprovalMode(undefined), 'always');

console.log('types normalize tests passed');
