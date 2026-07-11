import { createRequire } from 'node:module';

// Vite's bundled builtin list predates `node:sqlite`, so import it through
// require rather than letting Vite try to resolve it as a package.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: never[]): unknown; get(...p: never[]): unknown; all(...p: never[]): unknown[] };
    close(): void;
  };
};

/**
 * A real SQLite database, shaped like the better-sqlite3 handle the main
 * process passes around. `node:sqlite` ships with Node (and with FTS5), so the
 * code under test executes genuine SQL rather than talking to a mock; only the
 * two conveniences better-sqlite3 adds — `.transaction()` and `.pragma()` — are
 * supplied here.
 */
export interface TestDb {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  exec(sql: string): void;
  close(): void;
}

/** The subset of the app's schema that compaction reads and writes. */
const SCHEMA = `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  message_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  last_compaction_at INTEGER,
  tokens_saved_by_compaction INTEGER DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  reasoning TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  model TEXT,
  provider TEXT,
  usage TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content, conversation_id UNINDEXED, message_id UNINDEXED
);
`;

export function createTestDb(): TestDb {
  return createTestDbFromSchema(SCHEMA);
}

export function createTestDbFromSchema(schema: string): TestDb {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);

  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      // Reject `undefined` rather than quietly binding NULL. better-sqlite3
      // throws on undefined parameters, so silently coercing here would let a
      // binding bug pass the tests and still crash in production.
      const check = (params: unknown[]): never[] => {
        const i = params.findIndex((p) => p === undefined);
        if (i !== -1) throw new TypeError(`undefined bound to parameter ${i + 1} of: ${sql.trim().slice(0, 60)}`);
        return params as never[];
      };
      return {
        run: (...params: unknown[]) => stmt.run(...check(params)),
        get: (...params: unknown[]) => stmt.get(...check(params)),
        all: (...params: unknown[]) => stmt.all(...check(params))
      };
    },
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => {
        db.exec('BEGIN');
        try {
          const out = fn(...args);
          db.exec('COMMIT');
          return out;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }) as T;
    },
    exec: (sql: string) => db.exec(sql),
    close: () => db.close()
  };
}

/** Insert a conversation plus an ordered list of messages. */
export function seedConversation(
  db: TestDb,
  conversationId: string,
  messages: Array<{
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCalls?: string;
    toolCallId?: string;
  }>
): void {
  db.prepare('INSERT INTO conversations (id, title, updated_at) VALUES (?, ?, ?)')
    .run(conversationId, 'test', 1000);

  const insert = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, reasoning, tool_calls, tool_call_id, name, model, provider, usage, error, created_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(
    'INSERT INTO messages_fts (rowid, content, conversation_id, message_id) VALUES (last_insert_rowid(), ?, ?, ?)'
  );

  messages.forEach((m, i) => {
    insert.run(
      m.id, conversationId, m.role, m.content,
      null, m.toolCalls ?? null, m.toolCallId ?? null, m.name ?? null,
      null, null, null, null, 1000 + i, i
    );
    insertFts.run(m.content, conversationId, m.id);
  });
}

export const rowsOf = (db: TestDb, conversationId: string) =>
  db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
    .all(conversationId) as Array<Record<string, unknown>>;
