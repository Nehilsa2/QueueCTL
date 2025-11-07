const db = require('./db');
const { nowIso, uuidv4 } = require('./utils');

function enqueue(jobJson) {
  const job = typeof jobJson === 'string' ? JSON.parse(jobJson) : jobJson;
  const id = job.id || uuidv4();
  const command = job.command;
  const max_retries = job.max_retries !== undefined ? job.max_retries : parseInt(require('./config').getConfig('max_retries'));
  const created_at = job.created_at || nowIso();
  const updated_at = nowIso();
  const state = job.state || 'pending';
  const next_run_at = job.next_run_at || null;

  const stmt = db.prepare(`INSERT INTO jobs (id,command,state,attempts,max_retries,created_at,updated_at,next_run_at,last_error,worker_id) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  stmt.run(id, command, state, 0, max_retries, created_at, updated_at, next_run_at, null, null);
  return id;
}

function getStatusSummary() {
  const rows = db.prepare(`SELECT state, COUNT(*) as cnt FROM jobs GROUP BY state`).all();
  const summary = rows.reduce((acc, r) => { acc[r.state] = r.cnt; return acc; }, {});
  const pending = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE state='pending' AND (next_run_at IS NULL OR next_run_at <= ?)`).get(nowIso()).c;
  return { by_state: summary, ready_pending: pending };
}

function listJobs(state=null) {
  if (state) {
    return db.prepare(`SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC`).all(state);
  } else {
    return db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`).all();
  }
}

function fetchNextJobForProcessing(workerId) {
  // atomically pick a job that is pending, next_run_at <= now, and lock it (set state to processing and worker_id)
  const now = nowIso();
  // allow picking up jobs that are pending or previously failed (retryable)
  const getStmt = db.prepare(`SELECT * FROM jobs WHERE (state='pending' OR state='failed') AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at ASC LIMIT 1`);
  const job = getStmt.get(now);
  if (!job) return null;

  const update = db.prepare(`UPDATE jobs SET state='processing', worker_id=?, updated_at=? WHERE id=? AND (state='pending' OR state='failed')`);
  const info = update.run(workerId, now, job.id);
  if (info.changes === 1) {
    return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
  } else {
    return null;
  }
}

function markJobCompleted(id) {
  const stmt = db.prepare(`UPDATE jobs SET state='completed', updated_at=? WHERE id = ?`);
  stmt.run(nowIso(), id);
}

function markJobFailed(id, errMsg, attempts, max_retries, backoffSeconds) {
  const now = nowIso();
  if (attempts >= max_retries) {
    // final failure → move to dead (DLQ)
    console.log(`[queue] job ${id} exceeded max retries and moved to DLQ`);
    const stmt = db.prepare(`UPDATE jobs SET state='dead', last_error=?, attempts=?, updated_at=?, worker_id=NULL WHERE id=?`);
    stmt.run(errMsg, attempts, now, id);
  } else {
    // retryable failure — schedule next run
    const nextRun = new Date(Date.now() + backoffSeconds*1000).toISOString();
    console.log(`[queue] job ${id} will retry in ${backoffSeconds}s`);
    const stmt = db.prepare(`UPDATE jobs SET state='failed', last_error=?, attempts=?, next_run_at=?, updated_at=?, worker_id=NULL WHERE id=?`);
    stmt.run(errMsg, attempts, nextRun, now, id);
  }
}

function moveDlqRetry(id) {
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ? AND state = 'dead'`).get(id);
  if (!job) throw new Error('No dead job found with id '+id);
  const stmt = db.prepare(`UPDATE jobs SET state='pending', attempts=0, last_error=NULL, next_run_at=NULL, updated_at=? WHERE id=?`);
  stmt.run(nowIso(), id);
}
function listDeadJobs() {
  const stmt = db.prepare(`SELECT * FROM jobs WHERE state='dead'`);
  return stmt.all();
}
function deleteJob(id) {
  return db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id).changes;
}
function listAllJobs() {
  const stmt = db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`);
  return stmt.all();
}

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


module.exports = {
  enqueue, getStatusSummary, listJobs, fetchNextJobForProcessing,
  markJobCompleted, markJobFailed, moveDlqRetry, deleteJob,listDeadJobs,listAllJobs,markJobDead
};
