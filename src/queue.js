import db from './db.js';
import { nowIso, uuidv4 } from './utils.js';
import * as config from './config.js';

// Enqueue
function enqueue(jobJson) {
  const job = typeof jobJson === 'string' ? JSON.parse(jobJson) : jobJson;
  const id = job.id || uuidv4();
  const command = job.command;
  const max_retries = job.max_retries || parseInt(config.getConfig('max_retries') || '3', 10);
  const priority = job.priority ?? 100;
  const created_at = nowIso();
  const updated_at = created_at;

  let run_at = job.run_at || null;

  // 🕓 Interpret given run_at as local IST time (not UTC)
  if (run_at && !run_at.endsWith('Z')) {
    const istDate = new Date(run_at + '+05:30');
    run_at = istDate.toISOString();
  }

  // scheduled if future, else pending
  const state = run_at && new Date(run_at) > new Date() ? 'scheduled' : 'pending';

  const stmt = db.prepare(`
    INSERT INTO jobs (
      id, command, state, attempts, max_retries, created_at, updated_at, priority, run_at, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, command, state, 0, max_retries, created_at, updated_at, priority, run_at, run_at);

  console.log(
    state === 'scheduled'
      ? `⏰ Scheduled job ${id} for ${run_at}`
      : `✅ Enqueued job ${id} (ready now)`
  );
  return id;
}

// Activate scheduled jobs when due
function activateScheduledJobs() {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE jobs
    SET state = 'pending', updated_at = ?
    WHERE state = 'scheduled'
      AND run_at IS NOT NULL
      AND datetime(run_at) <= datetime(?)
  `);
  const info = stmt.run(now, now);
  if (info.changes > 0) {
    console.log(`⏱️ Activated ${info.changes} scheduled job(s) ready for processing`);
  }
}

// Reactivate waiting jobs ready for retry
function reactivateWaitingJobs() {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE jobs
    SET state='pending', updated_at=?
    WHERE state='waiting'
      AND next_run_at IS NOT NULL
      AND datetime(next_run_at) <= datetime(?)`);
  const info = stmt.run(now, now);
  if (info.changes > 0) {
    console.log(`⚡ Reactivated ${info.changes} job(s) ready for retry`);
  }
}

// Auto-activate missed jobs
function autoActivateMissedJobs() {
  const now = nowIso();
  const stmt = db.prepare(`
    UPDATE jobs
    SET next_run_at = ?, updated_at = ?
    WHERE state = 'pending'
      AND run_at IS NOT NULL
      AND datetime(run_at) < datetime(?)
  `);
  stmt.run(now, now, now);
}



function fetchNextJobForProcessing(workerId) {
  // Pick the highest priority job available for execution
  const job = db
    .prepare(
      `
      SELECT * FROM jobs
      WHERE state = 'pending'
      ORDER BY 
        priority DESC,                         -- higher priority first
        CASE 
          WHEN run_at IS NULL THEN 1 
          ELSE 0 
        END,                                   -- jobs without schedule last
        datetime(run_at) ASC,                  -- earlier scheduled jobs first
        datetime(created_at) ASC               -- earliest created first
      LIMIT 1
      `
    )
    .get();

  if (!job) return null;

  // Lock and assign the job to this worker
  db.prepare(
    `
    UPDATE jobs 
    SET 
      state='processing', 
      worker_id=?, 
      updated_at=datetime('now')
    WHERE id=?
    `
  ).run(workerId, job.id);

  console.log(
    `[queue] 🧩 picked job ${job.id} (priority=${job.priority || 0}, run_at=${job.run_at || 'NULL'})`
  );

  return job;
}


// Mark job success/failure
function markJobCompleted(id) {
  db.prepare(`UPDATE jobs SET state='completed', updated_at=? WHERE id=?`).run(nowIso(), id);
}
function markJobFailed(id, errMsg, attempts, max_retries, backoffSeconds) {
  const now = nowIso();
  if (attempts > max_retries) {
    console.log(`[queue] ❌ job ${id} exceeded max retries and moved to DLQ`);
    db.prepare(`
      UPDATE jobs SET state='dead', attempts=?, updated_at=?, worker_id=NULL WHERE id=?
    `).run(attempts, now, id);
  } else {
    const nextRun = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    console.log(`[queue] 🔁 job ${id} retry scheduled in ${backoffSeconds}s`);
    db.prepare(`
      UPDATE jobs
      SET state='waiting', attempts=?, next_run_at=?, updated_at=?, worker_id=NULL
      WHERE id=?
    `).run(attempts, nextRun, now, id);
  }
}


function listJobs(state = null) {
  try {
    let query = `SELECT id, command, state, attempts, max_retries, created_at, updated_at, run_at, next_run_at, worker_id
                 FROM jobs`;
    let params = [];

    if (state) {
      query += ` WHERE state = ?`;
      params.push(state);
    }

    query += ` ORDER BY created_at DESC`;

    const rows = db.prepare(query).all(...params);
    return rows;
  } catch (err) {
    console.error("❌ Error fetching jobs:", err.message);
    return [];
  }
}


// 🪦 List all jobs in Dead Letter Queue (DLQ)
function listDeadJobs() {
  try {
    const rows = db
      .prepare(`
        SELECT id, command, attempts, max_retries, created_at, updated_at, run_at, worker_id
        FROM jobs
        WHERE state = 'dead'
        ORDER BY updated_at DESC
      `)
      .all();

    return rows;
  } catch (err) {
    console.error("❌ Error fetching DLQ jobs:", err.message);
    return [];
  }
}


// 🔁 Retry a dead job (single or all)
function retryDeadJob(jobId = null) {
  if (jobId) {
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ? AND state = 'dead'`).get(jobId);
    if (!job) throw new Error(`No dead job found with ID '${jobId}'`);
    db.prepare(
      `UPDATE jobs SET state='pending', attempts=0, next_run_at=NULL, updated_at=datetime('now') WHERE id=?`
    ).run(jobId);
    return 1;
  } else {
    const info = db
      .prepare(`UPDATE jobs SET state='pending', attempts=0, next_run_at=NULL, updated_at=datetime('now') WHERE state='dead'`)
      .run();
    return info.changes;
  }
}

// 🧹 Clear all dead jobs
function clearDeadJobs() {
  const info = db.prepare(`DELETE FROM jobs WHERE state='dead'`).run();
  return info.changes;
}




// Status helpers
function getStatusSummary() {
  const rows = db.prepare(`SELECT state, COUNT(*) as cnt FROM jobs GROUP BY state`).all();
  const summary = rows.reduce((a, r) => ((a[r.state] = r.cnt), a), {});
  const pending = db
    .prepare(`SELECT COUNT(*) as c FROM jobs WHERE state='pending' AND (next_run_at IS NULL OR next_run_at <= ?)`)
    .get(nowIso()).c;
  return { by_state: summary, ready_pending: pending };
}

export {
  enqueue,
  fetchNextJobForProcessing,
  markJobCompleted,
  markJobFailed,
  reactivateWaitingJobs,
  activateScheduledJobs,
  autoActivateMissedJobs,
  getStatusSummary,
  listJobs,
  listDeadJobs,
  retryDeadJob,
  clearDeadJobs
};

