// SQLite data layer using Node's built-in node:sqlite (no native compilation).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const dataDir = process.env.ELIO_DATA_DIR || process.env.MUSE_DATA_DIR || path.join(process.cwd(), "data");

// ── Lazy, build-safe database open ────────────────────────────────────────
// `next build` imports every route while collecting page data; opening
// SQLite and running DDL at module-import time made Next's parallel build
// workers race on the same database file ("database is locked",
// ERR_SQLITE_ERROR 5). The connection is therefore opened and the schema
// ensured on first *use* — i.e. at request time on the server — never at
// import time. Runtime behavior is unchanged: same file, same pragmas,
// same idempotent schema.
let _db: DatabaseSync | null = null;

function openDb(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "muse.db");
  const d = new DatabaseSync(dbPath);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  // Bound how long a writer waits on a transient lock instead of failing
  // immediately (scheduler, agent runs and requests share one process).
  d.exec("PRAGMA busy_timeout = 5000;");
  d.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  salt TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'Member',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','waiting_approval','done','failed','cancelled')),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  risk TEXT
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_secrets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  surrogate TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connector_grants (
  id TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connected','error')),
  account_email TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_iv TEXT,
  token_tag TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(connector)
);
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'morning',
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_digests_ts ON digests(ts);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fired','cancelled')),
  channel TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL,
  fired_at INTEGER,
  conversation_id TEXT,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  description TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'daily',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  last_run INTEGER,
  last_summary TEXT,
  last_change TEXT,
  conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_steps_task ON task_steps(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
  `);
  _db = d;
  // Make the resolved data location visible in deploy logs — on platforms like
  // Railway this is how you verify the DB actually lives on a mounted volume
  // (a path outside the volume means every redeploy silently wipes all data).
  console.log(`[elio] database: ${dbPath}`);  return d;
}

// Type-preserving lazy handle: `db` keeps its DatabaseSync type so every
// existing consumer (db.prepare().get()/all()/run(), db.exec, …) works
// unchanged; the real connection opens on the first property access.
export const db = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const d = openDb();
    const value = Reflect.get(d, prop);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(d) : value;
  },
});

export const now = () => Date.now();
export const uuid = () => randomUUID();

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function audit(
  actor: string,
  action: string,
  opts: { target?: string; detail?: string; risk?: string } = {}
) {
  db.prepare(
    "INSERT INTO audit_log (id, ts, actor, action, target, detail, risk) VALUES (?,?,?,?,?,?,?)"
  ).run(uuid(), now(), actor, action, opts.target ?? null, opts.detail ?? null, opts.risk ?? null);
}

export function addStep(taskId: string, kind: string, detail: string) {
  try {
    const row = db
      .prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM task_steps WHERE task_id = ?")
      .get(taskId) as { next: number };
    db.prepare(
      "INSERT INTO task_steps (id, task_id, seq, kind, detail, created_at) VALUES (?,?,?,?,?,?)"
    ).run(uuid(), taskId, row.next, kind, detail, now());
  } catch {
    // Task row may have been deleted while a background run was in flight —
    // never let step logging crash the runner.
  }
}
