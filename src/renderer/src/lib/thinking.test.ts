import assert from 'node:assert/strict';
import { extractThinking } from './thinking';

// ─── extractThinking — basic extraction ────────────────────────────────────

assert.deepEqual(extractThinking(''), { content: '', thinking: '' });

// No thinking tags → passthrough
assert.deepEqual(extractThinking('hello world'), { content: 'hello world', thinking: '' });

// ─── Single block variants ─────────────────────────────────────────────────

assert.deepEqual(
  extractThinking('<think>I should check the docs first</think>Answer here'),
  { content: 'Answer here', thinking: 'I should check the docs first' }
);

// tag name variations
assert.deepEqual(
  extractThinking('<thinking>reasoning step</thinking>Result'),
  { content: 'Result', thinking: 'reasoning step' }
);

assert.deepEqual(
  extractThinking('<thought>inner monologue</thought>Output'),
  { content: 'Output', thinking: 'inner monologue' }
);

// ─── Multiple blocks ───────────────────────────────────────────────────────

assert.deepEqual(
  extractThinking('<think>first</think><think>second</think>Final'),
  { content: 'Final', thinking: 'first\n\nsecond' }
);

// ─── HTML-escaped variants ─────────────────────────────────────────────────

assert.deepEqual(
  extractThinking('&lt;think&gt;escaped content&lt;/think&gt;Plain text'),
  { content: 'Plain text', thinking: 'escaped content' }
);

// ─── Stray close tags ─────────────────────────────────────────────────────

// Stray closes are stripped (not just outer ones)
assert.deepEqual(
  extractThinking('</think>before<think>active</think>after'),
  { content: 'beforeafter', thinking: 'active' }
);

// ─── Unclosed streaming tag ─────────────────────────────────────────────────

// Still-open tag at end — treats all after-open content as pending thinking
const streaming = extractThinking('<think>still streaming');
assert.equal(streaming.thinking, 'still streaming');
assert.equal(streaming.content, '');

// Content before unclosed tag is preserved as content
const streaming2 = extractThinking('prefix<think>unclosed reasoning');
assert.equal(streaming2.content, 'prefix');
assert.equal(streaming2.thinking, 'unclosed reasoning');

// ─── Mixed escaped/unclosed ────────────────────────────────────────────────

assert.deepEqual(
  extractThinking('&lt;think&gt;escaped open&lt;/think&gt;Normal <think>unclosed'),
  { content: 'Normal', thinking: 'escaped open\n\nunclosed' }
);

// ─── Whitespace normalisation ───────────────────────────────────────────────

assert.deepEqual(
  extractThinking('  <think>  spaced  </think>  \n\n\n\n  content  '),
  { content: 'content', thinking: 'spaced' }
);

// ─── Content-only result ───────────────────────────────────────────────────

const noThink = extractThinking('plain response with no thinking');
assert.equal(noThink.thinking, '');
assert.equal(noThink.content, 'plain response with no thinking');
