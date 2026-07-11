import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../utils/paths';
import { logger } from '../utils/logger';

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  provider_id TEXT,
  model TEXT,
  system_prompt TEXT,
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  project_id TEXT REFERENCES projects(id),
  parent_id TEXT,
  total_tokens INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  preview TEXT,
  compaction_count INTEGER DEFAULT 0,
  last_compaction_at INTEGER,
  tokens_saved_by_compaction INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_archived ON conversations(archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  model TEXT,
  provider TEXT,
  usage TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  bookmarked INTEGER DEFAULT 0,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_msg_bookmarked ON messages(bookmarked) WHERE bookmarked = 1;

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  preset_id TEXT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_ref TEXT,
  enabled INTEGER DEFAULT 1,
  models TEXT,
  custom_headers TEXT,
  models_fetched_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT NOT NULL DEFAULT '',
  url TEXT,
  args TEXT,
  env TEXT,
  cwd TEXT,
  timeout_ms INTEGER,
  trust INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  slash_command TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  builtin INTEGER DEFAULT 0,
  category TEXT,
  source_dir TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📁',
  color TEXT,
  path TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_outbox_project ON knowledge_outbox(project_id, created_at);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  pattern TEXT,
  action TEXT NOT NULL,
  scope TEXT,
  project_path TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,
  language TEXT,
  title TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_artifact_conv ON artifacts(conversation_id);

CREATE TABLE IF NOT EXISTS swarm_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  project_id TEXT,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  worker_count INTEGER NOT NULL,
  repo_root TEXT,
  base_branch TEXT,
  base_head TEXT,
  integration_branch TEXT,
  integration_path TEXT,
  integration_head TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_runs_updated ON swarm_runs(updated_at DESC);

CREATE TABLE IF NOT EXISTS swarm_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  task_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  worktree_path TEXT,
  branch_name TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  UNIQUE(run_id, phase, task_index)
);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_run ON swarm_tasks(run_id, phase, task_index);
`;

const CURRENT_SCHEMA_VERSION = 11;

export async function initDb(): Promise<void> {
  const dir = dirname(paths.db);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(paths.db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  runMigrations(db);
  logger.info('db', `initialized at ${paths.db} (schema v${CURRENT_SCHEMA_VERSION})`);
}

interface Migration {
  version: number;
  description: string;
  up: (database: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 2,
    description: 'Add providers.models_fetched_at',
    up: (database) => {
      database.exec(`ALTER TABLE providers ADD COLUMN models_fetched_at INTEGER`);
    }
  },
  {
    version: 3,
    description: 'Rename project_path to project_id and add projects table',
    up: (database) => {
      database.exec(`ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id)`);
      database.exec(`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '📁',
        color TEXT,
        path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
    }
  },
  {
    version: 4,
    description: 'Add parent_id to conversations for fork lineage',
    up: (database) => {
      database.exec(`ALTER TABLE conversations ADD COLUMN parent_id TEXT`);
    }
  },
  {
    version: 5,
    description: 'Add compaction telemetry fields to conversations',
    up: (database) => {
      database.exec(`ALTER TABLE conversations ADD COLUMN compaction_count INTEGER DEFAULT 0`);
      database.exec(`ALTER TABLE conversations ADD COLUMN last_compaction_at INTEGER`);
      database.exec(`ALTER TABLE conversations ADD COLUMN tokens_saved_by_compaction INTEGER DEFAULT 0`);
    }
  },
  {
    version: 6,
    description: 'Add skills.source_dir for file-synced skills',
    up: (database) => {
      database.exec(`ALTER TABLE skills ADD COLUMN source_dir TEXT`);
    }
  },
  {
    version: 7,
    description: 'Add HTTP transport fields to MCP servers',
    up: (database) => {
      const columns = new Set(
        (database.prepare('PRAGMA table_info(mcp_servers)').all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has('transport')) database.exec(`ALTER TABLE mcp_servers ADD COLUMN transport TEXT NOT NULL DEFAULT 'stdio'`);
      if (!columns.has('url')) database.exec(`ALTER TABLE mcp_servers ADD COLUMN url TEXT`);
    }
  },
  {
    version: 8,
    description: 'Reconcile bookmarks, file-backed skills, and HTTP MCP fields',
    up: (database) => {
      const ensureColumn = (table: string, name: string, definition: string): void => {
        const columns = new Set(
          (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
        );
        if (!columns.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
      };

      ensureColumn('messages', 'bookmarked', 'bookmarked INTEGER DEFAULT 0');
      ensureColumn('skills', 'source_dir', 'source_dir TEXT');
      ensureColumn('mcp_servers', 'transport', "transport TEXT NOT NULL DEFAULT 'stdio'");
      ensureColumn('mcp_servers', 'url', 'url TEXT');
      database.exec(`CREATE INDEX IF NOT EXISTS idx_msg_bookmarked ON messages(bookmarked) WHERE bookmarked = 1`);
      database.exec(`CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
    }
  },
  {
    version: 9,
    description: 'Add native swarm runs and tasks',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS swarm_runs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT,
          project_id TEXT,
          prompt TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model TEXT NOT NULL,
          worker_count INTEGER NOT NULL,
          repo_root TEXT,
          base_branch TEXT,
          base_head TEXT,
          integration_branch TEXT,
          integration_path TEXT,
          integration_head TEXT,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_swarm_runs_updated ON swarm_runs(updated_at DESC);
        CREATE TABLE IF NOT EXISTS swarm_tasks (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
          phase TEXT NOT NULL,
          task_index INTEGER NOT NULL,
          status TEXT NOT NULL,
          output TEXT,
          error TEXT,
          worktree_path TEXT,
          branch_name TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          UNIQUE(run_id, phase, task_index)
        );
        CREATE INDEX IF NOT EXISTS idx_swarm_tasks_run ON swarm_tasks(run_id, phase, task_index);
      `);
    }
  },
  {
    version: 10,
    description: 'Pin the reviewed swarm integration commit',
    up: (database) => {
      const columns = new Set(
        (database.prepare('PRAGMA table_info(swarm_runs)').all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has('integration_head')) database.exec('ALTER TABLE swarm_runs ADD COLUMN integration_head TEXT');
    }
  },
  {
    version: 11,
    description: 'Add project config and knowledge capture outbox',
    up: (database) => {
      const columns = new Set(
        (database.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map((column) => column.name)
      );
      if (!columns.has('config')) database.exec("ALTER TABLE projects ADD COLUMN config TEXT NOT NULL DEFAULT '{}'");
      database.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_outbox (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          content TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_outbox_project ON knowledge_outbox(project_id, created_at);
      `);
    }
  }
];

export function runMigrations(database: Database.Database): void {
  // Get current version (0 if no row exists)
  const versionRow = database.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null } | undefined;
  const currentVersion = versionRow?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    try {
      database.transaction(() => {
        migration.up(database);
        database.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
      })();
      logger.info('db', `migration v${migration.version} applied: ${migration.description}`);
    } catch (err) {
      // If the column already exists (e.g. half-applied before), record it as done
      if (err instanceof Error && /duplicate column name/i.test(err.message)) {
        logger.warn('db', `migration v${migration.version} skipped (already applied): ${migration.description}`);
        try {
          database.prepare('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
        } catch { /* swallow */ }
      } else {
        logger.error('db', `migration v${migration.version} failed: ${migration.description}`, err);
        throw err;
      }
    }
  }
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Settings helpers
export function getSetting<T = unknown>(key: string, fallback?: T): T | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return row.value as unknown as T; }
}

export function setSetting(key: string, value: unknown): void {
  const v = JSON.stringify(value);
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, v, now);
}
