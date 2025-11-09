import { spawn } from 'child_process';
import { delayMs } from './utils.js';
import * as queue from './queue.js';
import * as config from './config.js';
import db from './db.js';

class Worker {
  constructor(id, shutdownSignal) {
    this.id = id;
    this.running = true;
    this.shutdownSignal = shutdownSignal || (() => false);
    this.currentJob = null;
    this.jobInProgress = false;
  }

  async runLoop() {
    console.log(`[worker ${this.id}] started`);

    while (this.running) {
      // Check if a shutdown is requested
      if (this.shutdownSignal() && !this.jobInProgress) {
        console.log(`[worker ${this.id}] 🛑 shutdown signal received, no job running — exiting.`);
        break;
      }

      try {
        // Reactivate waiting or missed jobs
        queue.reactivateWaitingJobs();
        queue.autoActivateMissedJobs();

        //activate scheduled jobs
        queue.activateScheduledJobs();

        // Don’t pick a new job if shutdown requested
        if (this.shutdownSignal()) {
          await delayMs(1);
          continue;
        }

        const job = queue.fetchNextJobForProcessing(this.id);
        if (!job) {
          await delayMs(1);
          continue;
        }

        this.currentJob = job;
        this.jobInProgress = true;
        await this.executeJob(job);
        this.jobInProgress = false;
        this.currentJob = null;
      } catch (e) {
        console.error(`[worker ${this.id}] error:`, e);
        this.jobInProgress = false;
        this.currentJob = null;
        await delayMs(1);
      }
    }

    console.log(`[worker ${this.id}] 💤 exited run loop.`);
  }


  //---------EXECUTE JOBS----------

  async executeJob(job) {
  const jobId = job.id;
  const env = { ...process.env, ATTEMPT: String(job.attempts) };
  const timeoutSeconds = parseInt(config.getConfig('job_timeout', '300'), 10);
  const start = Date.now();

  console.log(`[worker ${this.id}] executing job ${jobId}: ${job.command}`);

  // 🚀 Always insert "Job started" log before execution
  try {
    db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
      .run(jobId, `🚀 Job started at ${new Date().toISOString()}`);
  } catch (e) {
    console.error(`[worker ${this.id}] failed to log start:`, e.message);
  }

  let proc;
  try {
    proc = spawn(
      process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      [process.platform === 'win32' ? '/c' : '-c', job.command],
      { env, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (spawnErr) {
    const attempts = job.attempts + 1;
    const maxRetries = job.max_retries;
    const base = parseFloat(config.getConfig('backoff_base', '2'));
    const backoffSeconds = Math.pow(base, attempts);

    queue.markJobFailed(jobId, spawnErr.message, attempts, maxRetries, backoffSeconds);
    db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
      .run(jobId, `⚠️ Failed to spawn process: ${spawnErr.message}`);
    db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
      .run(jobId, `🧩 Job terminated (spawn error) at ${new Date().toISOString()}`);
    return;
  }

  let killed = false;
  const timeoutHandle = setTimeout(() => {
    killed = true;
    console.log(`[worker ${this.id}] ⏱️ job ${jobId} exceeded timeout (${timeoutSeconds}s), terminating...`);
    proc.kill('SIGTERM');
  }, timeoutSeconds * 1000);

  // 📤 Capture stdout & stderr
  proc.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg) return;
    try {
      db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
        .run(jobId, `📤 ${msg}`);
    } catch (e) {
      console.error(`[worker ${this.id}] stdout log error:`, e.message);
    }
  });

  proc.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg) return;
    try {
      db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
        .run(jobId, `[stderr] ${msg}`);
    } catch (e) {
      console.error(`[worker ${this.id}] stderr log error:`, e.message);
    }
  });

  // Wait for job completion
  await new Promise((resolve) => {
    proc.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      const attempts = job.attempts + 1;
      const maxRetries = job.max_retries;
      const base = parseFloat(config.getConfig('backoff_base', '2'));
      const backoffSeconds = Math.pow(base, attempts);

      let statusMessage = '';
      if (killed || signal === 'SIGTERM') {
        statusMessage = `❌ Job timed out after ${duration}s`;
        queue.markJobFailed(jobId, 'timeout', attempts, maxRetries, backoffSeconds);
      } else if (code === 0) {
        statusMessage = `✅ Job completed successfully (duration: ${duration}s)`;
        queue.markJobCompleted(jobId);
      } else {
        statusMessage = `❌ Job failed with exit=${code}, retrying in ${backoffSeconds}s`;
        queue.markJobFailed(jobId, `exit=${code}`, attempts, maxRetries, backoffSeconds);
      }

      try {
        db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
          .run(jobId, statusMessage);
        db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
          .run(jobId, `🧩 Job terminated (exit=${code ?? 'N/A'}) at ${new Date().toISOString()}`);
      } catch (e) {
        console.error(`[worker ${this.id}] failed to log termination:`, e.message);
      }

      resolve();
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const attempts = job.attempts + 1;
      const maxRetries = job.max_retries;
      const base = parseFloat(config.getConfig('backoff_base', '2'));
      const backoffSeconds = Math.pow(base, attempts);
      queue.markJobFailed(jobId, err.message, attempts, maxRetries, backoffSeconds);

      try {
        db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
          .run(jobId, `⚠️ Job process error: ${err.message}`);
        db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
          .run(jobId, `🧩 Job terminated (error) at ${new Date().toISOString()}`);
      } catch (e) {
        console.error(`[worker ${this.id}] failed to log process error:`, e.message);
      }

      resolve();
    });
  });
}


  async stop() {
    console.log(`[worker ${this.id}] 🕓 Graceful stop requested...`);
    this.running = false;

    // Wait if job currently executing
    if (this.jobInProgress) {
      console.log(`[worker ${this.id}] waiting for job ${this.currentJob?.id} to finish...`);
      while (this.jobInProgress) {
        await delayMs(0.5);
      }
    }
  }
}

class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.shutdownRequested = false;
  }

  start(count = 1) {
    // Reset stuck jobs
    db.prepare(`UPDATE jobs SET state='pending', worker_id=NULL WHERE state='processing'`).run();

    for (let i = 0; i < count; i++) {
      const wid = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`;
      const worker = new Worker(wid, () => this.shutdownRequested);
      this.workers.set(wid, worker);
      worker.runLoop();
      console.log(`[manager] started ${wid}`);
    }
  }

  async stop() {
    console.log(`[manager] 🛑 graceful shutdown initiated...`);
    this.shutdownRequested = true;

    await Promise.all([...this.workers.values()].map((w) => w.stop()));

    console.log(`[manager] ✅ all workers stopped gracefully.`);
    this.workers.clear();
  }
}

export { WorkerManager };
