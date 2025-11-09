import express from "express";
import cors from "cors";
import db from "../src/db.js";
import * as queue from "../src/queue.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("QueueCTL API Running 🚀"));

// ✅ 1. Queue Summary (state counts + active workers)
app.get("/api/status", (req, res) => {
  try {
    const summary = queue.getStatusSummary();
    const workers = db
      .prepare("SELECT COUNT(DISTINCT worker_id) as active_workers FROM jobs WHERE state='processing'")
      .get();
    res.json({
      by_state: summary.by_state,
      ready_pending: summary.ready_pending,
      active_workers: workers.active_workers || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 2. List Jobs (optional ?state=pending)
app.get("/api/jobs", (req, res) => {
  try {
    const { state } = req.query;
    const jobs = state
      ? queue.listParticularJobs(state)
      : queue.listJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 3. Get a Single Job + Logs
app.get("/api/jobs/:id", (req, res) => {
  try {
    const job = queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const logs = queue.getJobLogs(req.params.id);
    res.json({ job, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 4. Retry a Dead Job (DLQ)
app.post("/api/dlq/retry/:id", (req, res) => {
  try {
    queue.moveDlqRetry(req.params.id);
    res.json({ message: `Job ${req.params.id} moved from DLQ to pending.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 5. Delete a Job
app.delete("/api/jobs/:id", (req, res) => {
  try {
    const changes = queue.deleteJob(req.params.id);
    if (changes === 0) return res.status(404).json({ error: "Job not found" });
    res.json({ message: `Job ${req.params.id} deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 6. Queue Metrics Summary
app.get("/api/metrics", (req, res) => {
  try {
    const metrics = db
      .prepare(`
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN state='dead' THEN 1 ELSE 0 END) AS timeouts,
          ROUND(AVG(duration), 2) AS avg_duration
        FROM job_metrics
      `)
      .get();

    const recent = db
      .prepare(`
        SELECT job_id, command, state, duration, completed_at
        FROM job_metrics
        ORDER BY completed_at DESC
        LIMIT 10
      `)
      .all();

    res.json({ metrics, recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 7. Reset Queue
app.post("/api/reset", (req, res) => {
  try {
    db.prepare("DELETE FROM jobs").run();
    db.prepare("DELETE FROM job_logs").run();
    db.prepare("DELETE FROM job_metrics").run();
    res.json({ message: "Queue reset successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 8. Enqueue a Job (optional direct API call)
app.post("/api/enqueue", (req, res) => {
  try {
    const job = req.body;
    if (!job || !job.command) {
      return res.status(400).json({ error: "Missing job command" });
    }
    const id = queue.enqueue(job);
    res.json({ message: "Job enqueued successfully", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Queue Dashboard API running at http://localhost:${PORT}`);
});
