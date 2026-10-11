// SQLite（Node.js 組み込み）によるデータ層。日時は会社の現地時刻を 'YYYY-MM-DD HH:MM' 文字列で保持する。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  capacity INTEGER,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  series_id TEXT,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_events_range ON events(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);
CREATE TABLE IF NOT EXISTS event_participants (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ep_user ON event_participants(user_id);
CREATE TABLE IF NOT EXISTS event_facilities (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, facility_id)
);
CREATE INDEX IF NOT EXISTS idx_ef_facility ON event_facilities(facility_id);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  amount INTEGER,
  applicant_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','returned','withdrawn')),
  current_step INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS request_steps (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  approver_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','approved','rejected','returned')),
  comment TEXT NOT NULL DEFAULT '',
  acted_at TEXT,
  PRIMARY KEY (request_id, step_no)
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS post_reads (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

// コールバックを1トランザクションで実行する（例外時はロールバック）。
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
