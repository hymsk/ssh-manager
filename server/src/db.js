import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let db = null

export function initDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(path.join(dataDir, 'ssh-manager.db'))
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  return db
}

export function getDb() {
  if (!db) throw new Error('Database not initialised')
  return db
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hosts (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  host                TEXT NOT NULL,
  port                INTEGER NOT NULL DEFAULT 22,
  username            TEXT NOT NULL,
  auth_type           TEXT NOT NULL DEFAULT 'password',
  secret              TEXT,
  passphrase          TEXT,
  group_name          TEXT,
  tags                TEXT NOT NULL DEFAULT '[]',
  favorite            INTEGER NOT NULL DEFAULT 0,
  host_fingerprint    TEXT,
  status              TEXT NOT NULL DEFAULT 'unknown',
  latency_ms          INTEGER,
  last_error          TEXT,
  last_checked_at     TEXT,
  last_online_at      TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  host_ids          TEXT NOT NULL DEFAULT '[]',
  command           TEXT NOT NULL DEFAULT '',
  type              TEXT NOT NULL DEFAULT 'command',
  schedule_type     TEXT NOT NULL DEFAULT 'manual',
  cron_expression   TEXT,
  interval_seconds  INTEGER,
  concurrency       INTEGER NOT NULL DEFAULT 5,
  timeout_seconds   INTEGER NOT NULL DEFAULT 60,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  continue_on_error INTEGER NOT NULL DEFAULT 1,
  skip_offline      INTEGER NOT NULL DEFAULT 1,
  last_run_id       TEXT,
  next_run_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT,
  name            TEXT NOT NULL,
  command         TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'command',
  trigger         TEXT NOT NULL DEFAULT 'manual',
  status          TEXT NOT NULL DEFAULT 'running',
  total_hosts     INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  options         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS run_results (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  host_id       TEXT NOT NULL,
  host_name     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  exit_code     INTEGER,
  stdout        TEXT,
  stderr        TEXT,
  error_message TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  duration_ms   INTEGER,
  retry_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_run_results_run ON run_results(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
`

export const nowIso = () => new Date().toISOString()

/** node:sqlite rejects undefined values; coerce them to null. */
export function clean(params) {
  return params.map((v) => (v === undefined ? null : v))
}

export function jsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
