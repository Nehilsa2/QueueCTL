const { spawn } = require('child_process');
const { delayMs } = require('./utils');
const queue = require('./queue');
const config = require('./config');

class Worker {
  constructor(id, shutdownSignal) {
    this.id = id;
    this.running = true;
    this.shutdownSignal = shutdownSignal || (() => false);
    this.currentJob = null;
  }

  async runLoop() {
    while (this.running && !this.shutdownSignal()) {
      try {
        const job = queue.fetchNextJobForProcessing(this.id);
        if (!job) {
          await delayMs(1); // idle 1s
          continue;
        }
        this.currentJob = job;
        await this.executeJob(job);
        this.currentJob = null;
      } catch (e) {
        console.error(`[worker ${this.id}] error loop:`, e);
        await delayMs(1);
      }
    }
    // graceful exit, let current job finish (currentJob tracked)
  }

  executeJob(job) {
    return new Promise((resolve) => {
      console.log(`[worker ${this.id}] executing job ${job.id}: ${job.command}`);
      // spawn a shell to execute command
      // expose the attempt count to the child process so scripts can inspect it
      const env = Object.assign({}, process.env, { ATTEMPT: String(job.attempts) });
      const proc = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        [process.platform === 'win32' ? '/c' : '-c', job.command],
        { stdio: 'inherit', env });

      proc.on('exit', (code, signal) => {
        const attempts = job.attempts + 1;
        const max_retries = job.max_retries;
        const backoffBase = parseFloat(config.getConfig('backoff_base') || '2');

        if (code === 0) {
          console.log(`[worker ${this.id}] job ${job.id} completed`);
          queue.markJobCompleted(job.id);
        } else {
          const backoffSeconds = Math.pow(backoffBase, attempts);
          const errMsg = `exit=${code} signal=${signal}`;

          // 👇 Main fix here
          if (attempts > max_retries) {
            console.log(
              `[worker ${this.id}] job ${job.id} exceeded max retries (${max_retries}). Moved to DLQ ❌`
            );
          } else {
            console.log(
              `[worker ${this.id}] job ${job.id} failed (code ${code}). attempt ${attempts}/${max_retries}. next in ${backoffSeconds}s`
            );
          }

          queue.markJobFailed(job.id, errMsg, attempts, max_retries, backoffSeconds);
        }

        resolve();
      });


      proc.on('error', (err) => {
        const attempts = job.attempts + 1;
        const max_retries = job.max_retries;
        const backoffBase = parseFloat(config.getConfig('backoff_base') || '2');
        const backoffSeconds = Math.pow(backoffBase, attempts);
        const errMsg = `error=${err.message}`;
        console.log(`[worker ${this.id}] job ${job.id} failed (error). attempt ${attempts}/${max_retries}. next in ${backoffSeconds}s`);
        queue.markJobFailed(job.id, errMsg, attempts, max_retries, backoffSeconds);
        resolve();
      });
    });
  }

  async stop() {
    this.running = false;
    // Reset any jobs this worker was processing
    if (this.currentJob) {
      const queue = require('./queue');
      queue.markJobFailed(this.currentJob.id, 'Worker stopped', this.currentJob.attempts, this.currentJob.max_retries, 0);
    }
  }
}

class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.shutdownRequested = false;
  }

  start(count = 1) {
    // Reset any stuck processing jobs to pending state
    const db = require('./db');
    db.prepare(`UPDATE jobs SET state='pending', worker_id=NULL WHERE state='processing'`).run();

    for (let i = 0; i < count; i++) {
      const wid = `worker-${Date.now()}-${Math.floor(Math.random() * 10000)}-${i}`;
      const w = new Worker(wid, () => this.shutdownRequested);
      this.workers.set(wid, w);
      w.runLoop();
      console.log(`[manager] started ${wid}`);
    }
  }

  async stop() {
    console.log(`[manager] graceful shutdown requested`);
    this.shutdownRequested = true;
    // tell each worker to stop accepting new jobs; they'll finish current
    for (const [id, w] of this.workers.entries()) {
      w.stop();
    }
    // wait until all workers have no currentJob
    while (true) {
      let busy = false;
      for (const w of this.workers.values()) {
        if (w.currentJob) busy = true;
      }
      if (!busy) break;
      await delayMs(1);
    }
    console.log('[manager] all workers idle, stopped.');
    this.workers.clear();
  }

  activeCount() { return this.workers.size; }
}

module.exports = { WorkerManager };
