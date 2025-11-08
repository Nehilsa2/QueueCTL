import db from './db.js';
import { nowIso, uuidv4 } from './utils.js';
import * as config from './config.js';

//Enqueue Function
function enqueue(jobJson) {
  const job = typeof jobJson === 'string' ? JSON.parse(jobJson) : jobJson;
  const id = job.id || uuidv4();
  const command = job.command;
  const max_retries = job.max_retries || parseInt(config.getConfig('max_retries') || '3', 10);
  const priority = job.priority ?? 100;
  const created_at = new Date().toISOString();
  const updated_at = created_at;

  // schedule future run time
  let run_at = job.run_at || null;

  // If user provided a local (no 'Z') timestamp, convert to UTC
  if (run_at && !run_at.endsWith('Z')) {
    const localDate = new Date(run_at); // interpreted as local time
    run_at = localDate.toISOString();   // convert to UTC ISO string
  }

  const state = 'pending';

  const stmt = db.prepare(`
    INSERT INTO jobs (
      id, command, state, attempts, max_retries, created_at, updated_at, priority, run_at, next_run_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, command, state, 0, max_retries, created_at, updated_at, priority, run_at, run_at);

  console.log(`✅ Enqueued job ${id}${run_at ? ` (scheduled at ${run_at})` : ''}`);
  return id;
}

//Get status of jobs 
function getStatusSummary() {
  const rows = db.prepare(`SELECT state, COUNT(*) as cnt FROM jobs GROUP BY state`).all();
  const summary = rows.reduce((acc, r) => { acc[r.state] = r.cnt; return acc; }, {});
  const pending = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE state='pending' AND (next_run_at IS NULL OR next_run_at <= ?)`).get(nowIso()).c;
  return { by_state: summary, ready_pending: pending };
}


//List all the jobs
function listJobs(state = null) {
  if (state) {
    return db.prepare(`SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC`).all(state);
  } else {
    return db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`).all();
  }
}

// Fetch the next job due to run
function fetchNextJobForProcessing(workerId) {
  const now = new Date().toISOString();

  const select = db.prepare(`
    SELECT * FROM jobs
    WHERE state = 'pending'
      AND (
        run_at IS NULL
        OR datetime(run_at) <= datetime(?)
      )
      AND (
        next_run_at IS NULL
        OR datetime(next_run_at) <= datetime(?)
      )
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
  `);

  const job = select.get(now, now);
  if (!job) return null;

  // Mark as processing
  const update = db.prepare(`
    UPDATE jobs
    SET state = 'processing', worker_id = ?, updated_at = ?
    WHERE id = ? AND state = 'pending'
  `);

  const info = update.run(workerId, now, job.id);
  if (info.changes === 0) return null;

  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
}

function autoActivateMissedJobs() {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE jobs
    SET next_run_at = ?, updated_at = ?
    WHERE state = 'pending'
      AND run_at IS NOT NULL
      AND datetime(run_at) < datetime(?)
  `);
  const info = stmt.run(now, now, now);
  if (info.changes > 0) {
    console.log(`⚡ Auto-activated ${info.changes} missed job(s) for immediate processing`);
  }
}



//Mark if the job is completed
function markJobCompleted(id) {
  const stmt = db.prepare(`UPDATE jobs SET state='completed', updated_at=? WHERE id = ?`);
  stmt.run(nowIso(), id);
}


//mark if job is failed
function markJobFailed(id, errMsg, attempts, max_retries, backoffSeconds) {
  const now = nowIso();
  if (attempts >= max_retries) {
    // final failure → move to dead (DLQ)
    console.log(`[queue] job ${id} exceeded max retries and moved to DLQ`);
    const stmt = db.prepare(`UPDATE jobs SET state='dead', last_error=?, attempts=?, updated_at=?, worker_id=NULL WHERE id=?`);
    stmt.run(errMsg, attempts, now, id);
  } else {
    // retryable failure — schedule next run
    const nextRun = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    console.log(`[queue] job ${id} will retry in ${backoffSeconds}s`);
    const stmt = db.prepare(`UPDATE jobs SET state='failed', last_error=?, attempts=?, next_run_at=?, updated_at=?, worker_id=NULL WHERE id=?`);
    stmt.run(errMsg, attempts, nextRun, now, id);
  }
}

//retry the jobs in DLQ
function moveDlqRetry(id) {
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ? AND state = 'dead'`).get(id);
  if (!job) throw new Error('No dead job found with id ' + id);
  const stmt = db.prepare(`UPDATE jobs SET state='pending', attempts=0, last_error=NULL, next_run_at=NULL, updated_at=? WHERE id=?`);
  stmt.run(nowIso(), id);
}

//list all the dead jobs
function listDeadJobs() {
  const stmt = db.prepare(`SELECT * FROM jobs WHERE state='dead'`);
  return stmt.all();
}

//delete jobs
function deleteJob(id) {
  return db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id).changes;
}

//list all jobs
function listAllJobs() {
  const stmt = db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`);
  return stmt.all();
}

//list particular state jobs

function listParticularJobs(state) {
  const stmt = db.prepare(`SELECT * FROM jobs where state= ? ORDER BY created_at DESC`);
  return stmt.all(state);
}

//mark job dead
function markJobDead(jobId, error, attempts) {
  const stmt = db.prepare(`
    UPDATE jobs
    SET state = 'dead',
        error = ?,
        attempts = ?
    WHERE id = ?
  `);
  stmt.run(error, attempts, jobId);

  // Optionally insert into DLQ table
  const dlqStmt = db.prepare(`
    INSERT INTO dlq (job_id, error, moved_at)
    VALUES (?, ?, datetime('now'))
  `);
  dlqStmt.run(jobId, error);

  console.log(`[queue] job ${jobId} saved to DLQ`);
}


// Append a log line to job_logs (safe if table missing)
function addJobLog(jobId, message) {
  try {
    const stmt = db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, ?)`);
    stmt.run(jobId, message, nowIso());
  } catch (e) {
    // ignore if table missing or any other DB error
  }
}

// Retrieve logs for a job
function getJobLogs(jobId) {
  try {
    const stmt = db.prepare(`SELECT * FROM job_logs WHERE job_id = ? ORDER BY created_at ASC`);
    return stmt.all(jobId);
  } catch (e) {
    return [];
  }
}

export {
  enqueue, getStatusSummary, listJobs, fetchNextJobForProcessing,
  markJobCompleted, markJobFailed, moveDlqRetry, deleteJob, listDeadJobs, listAllJobs, markJobDead, listParticularJobs, autoActivateMissedJobs
};
