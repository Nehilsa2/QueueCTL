import Database from 'better-sqlite3';

// open DB file
const db = new Database('./data/queue.sqlite');

console.log('🚀 Starting migration: adding `scheduled` to allowed job states...');

db.exec(`
BEGIN TRANSACTION;

-- create new table with updated CHECK constraint
CREATE TABLE jobs_new (
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

-- copy existing data
INSERT INTO jobs_new
  (id, command, state, attempts, max_retries, created_at, updated_at, priority, run_at, next_run_at, worker_id)
SELECT
  id, command, state, attempts, max_retries, created_at, updated_at, priority, run_at, next_run_at, worker_id
FROM jobs;

-- drop old table and rename new one
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

COMMIT;
`);

console.log('✅ Migration complete! The `scheduled` state is now supported.');
