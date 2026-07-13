import assert from 'node:assert/strict';
import { resolveAgent, shouldOrchestratorDispatch, BUILTIN_AGENTS } from './agents';

// ─── resolveAgent ─────────────────────────────────────────────────────────

const orchestrator = resolveAgent(undefined);
assert.equal(orchestrator.id, 'orchestrator');

const explicit = resolveAgent('explore');
assert.equal(explicit.id, 'explore');

const custom = resolveAgent('my-agent', [{ id: 'my-agent', name: 'My', prompt: 'test', description: 'Test' }]);
assert.equal(custom.id, 'my-agent');

// missing id with no custom falls back to orchestrator
const missing = resolveAgent('nonexistent');
assert.equal(missing.id, 'orchestrator');

// empty string
const emptyId = resolveAgent('');
assert.equal(emptyId.id, 'orchestrator');

// custom takes precedence over builtin when no match
const noMatchCustom = resolveAgent('nope', [{ id: 'other', name: 'X', prompt: 'y', description: '' }]);
assert.equal(noMatchCustom.id, 'orchestrator');

// custom with same id as builtin does NOT override (builtin wins)
const overrideTry = resolveAgent('explore', [{ id: 'explore', name: 'Custom', prompt: 'x', description: '' }]);
assert.equal(overrideTry.id, 'explore');
assert.equal(overrideTry.name, 'Explore'); // builtin name

// ─── shouldOrchestratorDispatch ───────────────────────────────────────────

// short text
assert.equal(shouldOrchestratorDispatch('fix bug'), false);
assert.equal(shouldOrchestratorDispatch('short'), false);

// long text with no discipline terms
const longBoring = 'x'.repeat(200);
assert.equal(shouldOrchestratorDispatch(longBoring), false);

// long text with 3+ discipline terms
const broadTask = 'Please implement the entire build system across all modules, test the complete pipeline thoroughly, and review the architecture for multiple components before shipping.';
assert.equal(shouldOrchestratorDispatch(broadTask), true);

// long text with 2 terms + broad scope
const twoTermsBroad = 'Please refactor the complete project structure across multiple files, implement the changes and test thoroughly throughout the entire codebase.';
assert.equal(shouldOrchestratorDispatch(twoTermsBroad), true);

// 2 terms without broad scope
const twoTermsNarrow = 'Please implement and test the login button component for the user profile page.';
assert.equal(shouldOrchestratorDispatch(twoTermsNarrow), false);

// boundary: exactly 120 chars
assert.equal(shouldOrchestratorDispatch('x'.repeat(119)), false);
assert.equal(shouldOrchestratorDispatch('implement build test ' + 'x'.repeat(100)), true);

// case insensitive
const mixedCase = 'IMPLEMENT the entire BUILD pipeline across every module and TEST all components thoroughly, and REVIEW the security architecture before shipping the final release.';
assert.equal(shouldOrchestratorDispatch(mixedCase), true);

// ─── BUILTIN_AGENTS — sanity ──────────────────────────────────────────────

assert.ok(BUILTIN_AGENTS.length >= 16);
assert.ok(BUILTIN_AGENTS.every((a) => a.id && a.name && a.prompt));

console.log('agents tests passed');
