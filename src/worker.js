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

  async executeJob(job) {
    console.log(`[worker ${this.id}] executing job ${job.id}: ${job.command}`);
    job.startTime = Date.now();

    const env = { ...process.env, ATTEMPT: String(job.attempts) };
    const proc = spawn(
      process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      [process.platform === 'win32' ? '/c' : '-c', job.command],
      { stdio: ['inherit', 'inherit', 'inherit'], env }
    );

    const timeoutSeconds = parseInt(config.getConfig('job_timeout', '300'), 10);
    const timeoutHandle = setTimeout(() => {
      console.log(`[worker ${this.id}] job ${job.id} timed out after ${timeoutSeconds}s`);
      proc.kill('SIGTERM');
    }, timeoutSeconds * 1000);

    await new Promise((resolve) => {
      proc.on('exit', (code, signal) => {
        clearTimeout(timeoutHandle);
        const attempts = job.attempts + 1;
        const maxRetries = job.max_retries;
        const base = parseFloat(config.getConfig('backoff_base', '2'));
        const backoffSeconds = Math.pow(base, attempts);

        if (code === 0) {
          console.log(`[worker ${this.id}] ✅ job ${job.id} completed successfully.`);
          queue.markJobCompleted(job.id);
        } else {
          const errMsg = signal === 'SIGTERM' ? 'timeout' : `exit=${code}`;
          console.log(`[worker ${this.id}] ❌ job ${job.id} failed. retrying in ${backoffSeconds}s`);
          queue.markJobFailed(job.id, errMsg, attempts, maxRetries, backoffSeconds);
        }
        resolve();
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutHandle);
        const attempts = job.attempts + 1;
        const maxRetries = job.max_retries;
        const base = parseFloat(config.getConfig('backoff_base', '2'));
        const backoffSeconds = Math.pow(base, attempts);

        console.log(`[worker ${this.id}] ⚠️ job ${job.id} failed to start (${err.message}). retry in ${backoffSeconds}s`);
        queue.markJobFailed(job.id, err.message, attempts, maxRetries, backoffSeconds);
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

    console.log(`[worker ${this.id}] ✅ finished current job and stopped.`);
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
