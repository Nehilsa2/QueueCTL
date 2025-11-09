import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const DB_PATH = path.join(DATA_DIR, 'queue.sqlite');

const db = new Database(DB_PATH);

// migrations / schema
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'waiting', 'completed', 'dead', 'scheduled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  priority INTEGER DEFAULT 100,
  run_at TEXT,
  next_run_at TEXT,
  worker_id TEXT
);


CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  log_output TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS job_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  command TEXT,
  state TEXT,
  duration REAL,
  completed_at TEXT DEFAULT (datetime('now')),
  worker_id TEXT,                -- ← NEW COLUMN
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
`);

// ──────────────────────────────────────────────────────────────
// Safe migration: add worker_id if it does not exist yet
// ──────────────────────────────────────────────────────────────
const tableInfo = db.pragma('table_info(job_metrics)');
const hasWorkerId = tableInfo.some(col => col.name === 'worker_id');
if (!hasWorkerId) {
  db.exec('ALTER TABLE job_metrics ADD COLUMN worker_id TEXT');
  console.log('Migration: added worker_id to job_metrics');
}

  


export default db;
