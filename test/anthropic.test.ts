import { describe, test, expect } from 'vitest';
import { AnthropicAdapter } from '../src/main/providers/anthropic';

const adapter = new AnthropicAdapter(
  { id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' } as ConstructorParameters<
    typeof AnthropicAdapter
  >[0],
  'test-key'
);

// toAnthropicMessages is a pure translation and the behaviour worth pinning;
// `private` is erased at runtime.
const translate = (messages: unknown[]): Array<{ role: string; content: unknown }> =>
  (adapter as unknown as { toAnthropicMessages(m: unknown[]): Array<{ role: string; content: unknown }> })
    .toAnthropicMessages(messages);

const SUMMARY =
  '<context_compaction>\nCompacted 40 older messages.\n## Files referenced\n• src/main/index.ts\n</context_compaction>';

describe('AnthropicAdapter.toAnthropicMessages', () => {
  test('carries a mid-conversation system message through', () => {
    // Auto-compaction deletes the history it summarises and writes the summary
    // back as a system message. Anthropic rejects a system role inside
    // `messages`, so dropping it would silently discard the compacted context.
    const out = translate([
      { role: 'system', content: SUMMARY },
      { role: 'user', content: 'what did we decide about the DB?' }
    ]);

    expect(out).toHaveLength(2);
    expect(JSON.stringify(out)).toContain('context_compaction');
    expect(out[0].role).toBe('user');
  });

  test('translates a plain user turn unchanged', () => {
    const out = translate([{ role: 'user', content: 'hello' }]);
    expect(out).toEqual([{ role: 'user', content: 'hello' }]);
  });

  test('folds a tool result into a user tool_result block', () => {
    const out = translate([
      { role: 'tool', content: 'file contents', toolCallId: 'call_1' }
    ]);

    expect(out).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file contents' }] }
    ]);
  });

  test('turns assistant tool_calls into tool_use blocks', () => {
    const out = translate([
      {
        role: 'assistant',
        content: 'looking that up',
        toolCalls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a"}' } }]
      }
    ]);

    expect(out[0].role).toBe('assistant');
    expect(out[0].content).toEqual([
      { type: 'text', text: 'looking that up' },
      { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a' } }
    ]);
  });

  test('drops an empty system message rather than sending a blank turn', () => {
    expect(translate([{ role: 'system', content: '' }])).toEqual([]);
  });
});
