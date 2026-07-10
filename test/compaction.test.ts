import { describe, test, expect } from 'vitest';
import { compactConversationInPlace } from '../src/main/ipc/chat';
import { createTestDb, seedConversation, rowsOf, type TestDb } from './helpers/sqlite';

const convo = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message ${i}`
  }));

const compact = (db: TestDb, id = 'c1') => compactConversationInPlace(id, 'p', 'm', db);

const ftsIds = (db: TestDb, conversationId: string) =>
  (db.prepare('SELECT message_id FROM messages_fts WHERE conversation_id = ?').all(conversationId) as Array<{
    message_id: string;
  }>).map((r) => r.message_id);

describe('compactConversationInPlace', () => {
  test('keeps the six most recent messages', async () => {
    const db = createTestDb();
    seedConversation(db, 'c1', convo(10));

    await compact(db);

    const kept = rowsOf(db, 'c1').filter((r) => r.role !== 'system');
    expect(kept.map((r) => r.content)).toEqual([
      'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9'
    ]);
  });

  test('replaces the older messages with exactly one summary', async () => {
    const db = createTestDb();
    seedConversation(db, 'c1', convo(10));

    const result = await compact(db);

    const summaries = rowsOf(db, 'c1').filter((r) => String(r.content).includes('<context_compaction>'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0].role).toBe('system');
    expect(summaries[0].content).toContain('Compacted 4 older messages.');
    expect(result.removedCount).toBe(4);
  });

  test('preserves pre-existing system messages verbatim', async () => {
    const db = createTestDb();
    seedConversation(db, 'c1', [
      { id: 'sys', role: 'system', content: 'you are a helpful assistant' },
      ...convo(10)
    ]);

    await compact(db);

    const sys = rowsOf(db, 'c1').find((r) => r.id === 'sys');
    expect(sys).toBeDefined();
    expect(sys!.content).toBe('you are a helpful assistant');
  });

  test('does nothing when the conversation is at or below the keep window', async () => {
    const db = createTestDb();
    seedConversation(db, 'c1', convo(6));
    const before = rowsOf(db, 'c1');

    const result = await compact(db);

    expect(result.removedCount).toBe(0);
    expect(rowsOf(db, 'c1')).toEqual(before);
    const conv = db.prepare('SELECT compaction_count FROM conversations WHERE id = ?').get('c1') as {
      compaction_count: number;
    };
    expect(conv.compaction_count).toBe(0);
  });

  test('leaves the full-text index consistent with the messages table', async () => {
    const db = createTestDb();
    seedConversation(db, 'c1', convo(10));

    await compact(db);

    const messageIds = rowsOf(db, 'c1').map((r) => r.id as string).sort();
    expect(ftsIds(db, 'c1').sort()).toEqual(messageIds);
  });

  test('never leaves a tool result without the assistant turn that requested it', async () => {
    const db = createTestDb();
    // The keep-window lands so that the tool result survives but the assistant
    // message carrying its tool_calls falls into the compacted-away older half.
    seedConversation(db, 'c1', [
      ...convo(5),
      { id: 'a-call', role: 'assistant', content: 'looking that up', toolCalls: '[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{}"}}]' },
      { id: 't-result', role: 'tool', content: 'file contents', toolCallId: 'call_1', name: 'read_file' },
      ...convo(5).map((m) => ({ ...m, id: `tail-${m.id}` }))
    ]);

    await compact(db);

    const rows = rowsOf(db, 'c1');
    const requestedIds = new Set(
      rows
        .filter((r) => r.role === 'assistant' && r.tool_calls)
        .flatMap((r) => (JSON.parse(r.tool_calls as string) as Array<{ id: string }>).map((c) => c.id))
    );
    const orphans = rows
      .filter((r) => r.role === 'tool')
      .filter((r) => !requestedIds.has(r.tool_call_id as string));

    expect(orphans.map((r) => r.tool_call_id)).toEqual([]);
  });

  test('updates the conversation compaction counters', async () => {
    const db = createTestDb();
    seedConversation(db, 'c1', [{ id: 'sys', role: 'system', content: 'sys' }, ...convo(10)]);

    await compact(db);

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get('c1') as Record<string, number>;
    // one preserved system message + the summary + the six recent turns
    expect(conv.message_count).toBe(8);
    expect(conv.compaction_count).toBe(1);
    expect(conv.last_compaction_at).toBeGreaterThan(0);
  });
});
