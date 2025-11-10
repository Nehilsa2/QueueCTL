import { spawn } from 'child_process';
import chalk from 'chalk';
import { delayMs, nowIso } from './utils.js';
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
    console.log(chalk.green(`${this.id} started`));

    while (this.running) {
      if (this.shutdownSignal() && !this.jobInProgress) {
        console.log(chalk.red(`${this.id} 🛑 exiting`));
        break;
      }

      try {
        queue.reactivateWaitingJobs();
        queue.autoActivateMissedJobs();
        queue.activateScheduledJobs();

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
        console.error(chalk.red(`${this.id} error:`), e);
        this.jobInProgress = false;
        this.currentJob = null;
        await delayMs(1);
      }
    }

    console.log(chalk.gray(`${this.id} 💤 exited`));
  }

  recordMetric(metricState, durationSec) {
    if (!this.currentJob) return;

    const jobId = this.currentJob.id;
    const command = this.currentJob.command;
    const workerId = this.id;
    const completedAt = nowIso();

    try {
      const existing = db
        .prepare(`SELECT id FROM job_metrics WHERE job_id = ?`)
        .get(jobId);

      if (existing) {
        db.prepare(`
          UPDATE job_metrics
          SET 
            state = ?,
            duration = ?,
            worker_id = ?,
            completed_at = ?
          WHERE job_id = ?
        `).run(metricState, durationSec, workerId, completedAt, jobId);
      } else {
        db.prepare(`
          INSERT INTO job_metrics
          (job_id, command, state, duration, worker_id, completed_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(jobId, command, metricState, durationSec, workerId, completedAt);
      }
    } catch (e) {
      console.error(chalk.red(`${this.id} metric failed:`), e.message);
    }
  }

  async executeJob(job) {
    const jobId = job.id;
    const env = { ...process.env, ATTEMPT: String(job.attempts) };
    const timeoutSeconds = parseInt(config.getConfig('job_timeout', '300'), 10);
    const start = Date.now();

    console.log(chalk.blue(`${this.id} exec ${jobId}: ${job.command}`));

    try {
      db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
        .run(jobId, `🚀 Job started at ${new Date().toISOString()}`);
    } catch (e) {
      console.error(chalk.red(`${this.id} log start failed:`), e.message);
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
        .run(jobId, `⚠️ Spawn failed: ${spawnErr.message}`);
      db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
        .run(jobId, `🧩 Terminated (spawn error) at ${new Date().toISOString()}`);

      const durationSec = (Date.now() - start) / 1000;
      this.recordMetric('failed', durationSec);

      const newJobState = db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId)?.state;
      if (newJobState === 'dead') {
        console.log(chalk.red(`${this.id} ❌ sent to DLQ ${jobId} [${attempts} attempts]`));
      } else {
        console.log(chalk.yellow(`${this.id} ❌ Spawn fail, retry in ${backoffSeconds}s (${attempts}/${maxRetries})`));
      }
      return;
    }

    let killed = false;
    const timeoutHandle = setTimeout(() => {
      killed = true;
      console.log(chalk.yellow(`${this.id} ⏱️ timeout ${jobId} (${timeoutSeconds}s)`));
      proc.kill('SIGTERM');
    }, timeoutSeconds * 1000);

    proc.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      console.log(chalk.green(`${this.id} out: ${msg}`));
      try {
        db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
          .run(jobId, `📤 ${msg}`);
      } catch (e) {
        console.error(chalk.red(`${this.id} out log failed:`), e.message);
      }
    });

    proc.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      try {
        db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
          .run(jobId, `[stderr] ${msg}`);
      } catch (e) {
        console.error(chalk.red(`${this.id} err log failed:`), e.message);
      }
    });

    await new Promise((resolve) => {
      proc.on('exit', (code, signal) => {
        clearTimeout(timeoutHandle);
        const durationSec = (Date.now() - start) / 1000;
        const durationStr = durationSec.toFixed(2);
        const attempts = job.attempts + 1;
        const maxRetries = job.max_retries;
        const base = parseFloat(config.getConfig('backoff_base', '2'));
        const backoffSeconds = Math.pow(base, attempts);

        let metricState;
        let statusMessage;

        if (killed || signal === 'SIGTERM') {
          metricState = 'timeout';
          statusMessage = `⏱️ Timeout ${durationStr}s`;
          queue.markJobFailed(jobId, 'timeout', attempts, maxRetries, backoffSeconds);
        } else if (code === 0) {
          metricState = 'completed';
          statusMessage = `✅ Done ${durationStr}s`;
          queue.markJobCompleted(jobId);
          console.log(chalk.green(`${this.id} ${statusMessage}`));
          this.recordMetric(metricState, durationSec);
          resolve();
          return;
        } else {
          metricState = 'failed';
          statusMessage = `❌ Fail exit=${code}`;
          queue.markJobFailed(jobId, `exit=${code}`, attempts, maxRetries, backoffSeconds);
        }

        try {
          db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
            .run(jobId, statusMessage);
          db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
            .run(jobId, `🧩 Terminated at ${new Date().toISOString()}`);
        } catch (e) {
          console.error(chalk.red(`${this.id} term log failed:`), e.message);
        }

        const newJobState = db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId)?.state;
        if (newJobState === 'dead') {
          console.log(chalk.red(`${this.id} ❌ sent to DLQ ${jobId} [${attempts} attempts]`));
        } else {
          console.log(chalk.yellow(`${this.id} ${statusMessage}, retry in ${backoffSeconds}s (${attempts}/${maxRetries})`));
        }

        this.recordMetric(metricState, durationSec);
        resolve();
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutHandle);
        const durationSec = (Date.now() - start) / 1000;
        const attempts = job.attempts + 1;
        const maxRetries = job.max_retries;
        const base = parseFloat(config.getConfig('backoff_base', '2'));
        const backoffSeconds = Math.pow(base, attempts);

        queue.markJobFailed(jobId, err.message, attempts, maxRetries, backoffSeconds);

        try {
          db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
            .run(jobId, `⚠️ Proc error: ${err.message}`);
          db.prepare(`INSERT INTO job_logs (job_id, log_output, created_at) VALUES (?, ?, datetime('now'))`)
            .run(jobId, `🧩 Terminated (error) at ${new Date().toISOString()}`);
        } catch (e) {
          console.error(chalk.red(`${this.id} proc log failed:`), e.message);
        }

        const newJobState = db.prepare('SELECT state FROM jobs WHERE id = ?').get(jobId)?.state;
        if (newJobState === 'dead') {
          console.log(chalk.red(`${this.id} ❌ sent to DLQ ${jobId} [${attempts} attempts]`));
        } else {
          console.log(chalk.yellow(`${this.id} ❌ Proc error, retry in ${backoffSeconds}s (${attempts}/${maxRetries})`));
        }

        this.recordMetric('failed', durationSec);
        resolve();
      });
    });
  }

  async stop() {
    console.log(chalk.gray(`${this.id} 🕓 stopping...`));
    this.running = false;

    if (this.jobInProgress) {
      console.log(chalk.gray(`${this.id} wait job ${this.currentJob?.id}`));
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
    }

    console.log(chalk.green(`🟢 Started ${count} worker(s)`));
  }

  async stop() {
    console.log(chalk.red(`🛑 Shutting down all workers...`));
    this.shutdownRequested = true;

    await Promise.all([...this.workers.values()].map((w) => w.stop()));

    console.log(chalk.green(`✅ All workers stopped`));
    this.workers.clear();
  }
}

export { WorkerManager };
