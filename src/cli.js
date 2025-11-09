#!/usr/bin/env node
import chalk from "chalk";
import { formatIST } from './utils.js';
import Table from 'cli-table3';
import db from './db.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as queue from './queue.js';
import { WorkerManager } from './worker.js';
import * as cfg from './config.js';



// Helper function to get color for job state
function getStateColor(state) {
  switch (state) {
    case 'pending': return 'yellow';
    case 'processing': return 'blue';
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'dead': return 'magenta';
    default: return 'white';
  }
}




yargs(hideBin(process.argv))
  // ---------- ENQUEUE ----------
  .command(
  "enqueue <job>",
  "Add a new job to the queue",
  (y) =>
    y.positional("job", {
      type: "string",
      describe: "Job JSON string, e.g. {\"command\":\"echo Hello\"}",
    }),
  (argv) => {
    try {
      const job = JSON.parse(argv.job);
      const id = queue.enqueue(job);
      console.log(`✅ Enqueued job id: ${id}`);
      process.exit(0); // force end
    } catch (err) {
      console.error("enqueue error:", err.message);
      process.exit(1);
    }
  }
)

  // ---------- WORKER ----------
  .command(
    "worker <action>",
    "Manage workers (start/stop)",
    (y) =>
      y
        .positional("action", {
          choices: ["start", "stop"],
          describe: "Start or stop workers",
        })
        .option("count", {
          alias: "c",
          type: "number",
          default: 1,
          describe: "Number of workers to start",
        }),
    (argv) => {
      const manager = new WorkerManager();

      if (argv.action === "start") {
        const count = argv.count || 1;
        manager.start(count);
        console.log("🟢 Workers started. Press Ctrl+C to stop gracefully.");

        process.on("SIGINT", async () => {
          console.log("\n🛑 Shutting down workers...");
          await manager.stop();
          process.exit(0);
        });
      } else if (argv.action === "stop") {
        console.log(
          "Stopping workers: press Ctrl+C in the worker terminal to stop them gracefully."
        );
      }
    }
  )

  // ---------- STATUS ----------
  .command(
    "status",
    "Show job status summary",
    () => {},
    () => {
      const summary = queue.getStatusSummary();
      console.log("📊 Queue Status:", summary);
      process.exit(0);
    }
  )

  //-----------DLQ------------//
 .command(
  'dlq <action> [jobId]',
  'Manage Dead Letter Queue (DLQ)',
  (y) =>
    y
      .positional('action', {
        choices: ['list', 'retry', 'clear'],
        describe: 'DLQ actions: list, retry all / one, or clear all',
      })
      .positional('jobId', {
        describe: 'Optional job ID (used with retry)',
        type: 'string',
      }),
  (argv) => {
    const { action, jobId } = argv;

    // 🪦 DLQ LIST — identical style to `queuectl list`
    if (action === 'list') {
      const jobs = queue.listDeadJobs();
      if (!jobs || jobs.length === 0) {
        console.log('🪦 DLQ empty — no dead jobs found.');
        return;
      }

      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Command'),
          chalk.cyan('State'),
          chalk.cyan('Attempts'),
          chalk.cyan('Max Retries'),
          chalk.cyan('Created At (IST)'),
          chalk.cyan('Updated At (IST)'),
        ],
        wordWrap: true,
        wrapOnWordBoundary: false,
        colWidths: [18, 25, 15, 10, 12, 24, 24],
      });

      jobs.forEach((job) => {
        table.push([
          job.id,
          job.command,
          chalk[
            job.state === 'completed'
              ? 'green'
              : job.state === 'processing'
              ? 'blue'
              : job.state === 'waiting'
              ? 'yellow'
              : job.state === 'scheduled'
              ? 'magenta'
              : job.state === 'dead'
              ? 'red'
              : 'white'
          ](job.state),
          job.attempts,
          job.max_retries,
          formatIST(job.created_at),
          formatIST(job.updated_at),
        ]);
      });

      console.log(table.toString());
      return;
    }

    // 🔁 DLQ RETRY (single or all)
    if (action === 'retry') {
      try {
        if (jobId) {
          const retried = queue.retryDeadJob(jobId);
          console.log(`🔁 Retried job '${jobId}' (${retried} record updated)`);
        } else {
          const retried = queue.retryDeadJob();
          if (retried > 0) console.log(`🔁 Retried ${retried} dead job(s)`);
          else console.log('🪦 DLQ empty — nothing to retry.');
        }
      } catch (err) {
        console.error(`❌ Failed to retry job: ${err.message}`);
      }
      return;
    }

    // 🧹 DLQ CLEAR
    if (action === 'clear') {
      const deleted = queue.clearDeadJobs();
      if (deleted > 0)
        console.log(`🧹 Cleared ${deleted} dead job(s) from DLQ permanently.`);
      else console.log('🪦 DLQ already empty.');
      return;
    }
  }
)






// ---------- LIST JOBS ----------
.command(
  'list',
  'List all jobs or filter by state',
  (y) => {
    y.option('state', {
      alias: 's',
      describe: 'Filter jobs by state (pending, processing, waiting, completed, dead, scheduled)',
      type: 'string',
    });
  },
  (argv) => {
    const { state } = argv;
    try {
      const jobs = queue.listJobs(state);
      if (!jobs || jobs.length === 0) {
        console.log(
          state
            ? `⚠️ No jobs found with state '${state}'`
            : '🗃️ No jobs found in the queue'
        );
        return;
      }

      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Command'),
          chalk.cyan('State'),
          chalk.cyan('Attempts'),
          chalk.cyan('Max Retries'),
          chalk.cyan('Created At (IST)'),
          chalk.cyan('Updated At (IST)'),
        ],
        wordWrap: true,
        wrapOnWordBoundary: false,
        colWidths: [18, 25, 18, 10, 12, 20, 20],
      });

      jobs.forEach((job) => {
        table.push([
          job.id,
          job.command,
          chalk[
            job.state === 'completed'
              ? 'green'
              : job.state === 'processing'
              ? 'blue'
              : job.state === 'waiting'
              ? 'yellow'
              : job.state === 'scheduled'
              ? 'magenta'
              : job.state === 'dead'
              ? 'red'
              : 'white'
          ](job.state),
          job.attempts,
          job.max_retries,
          formatIST(job.created_at),
          formatIST(job.updated_at),
        ]);
      });

      console.log(table.toString());
    } catch (err) {
      console.error('❌ Error listing jobs:', err.message);
    }
  }
)




  // ---------- LOGS ----------
  // ---------- LOGS ----------
.command(
  'logs <jobId>',
  'Show logs for a job (use --follow for live streaming)',
  (y) =>
    y
      .positional('jobId', { type: 'string', describe: 'Job id' })
      .option('follow', {
        alias: 'f',
        type: 'boolean',
        describe: 'Stream logs live (like tail -f)',
        default: false,
      }),
  async (argv) => {
    try {
      const job = queue.listJobs().find((j) => j.id === argv.jobId);
      if (!job) {
        console.error(`❌ No job found with id '${argv.jobId}'`);
        process.exit(1);
      }

      console.log(chalk.bold(`\n📘 Job: ${job.id}`));
      console.log(`Command: ${job.command}`);
      console.log(`State: ${job.state}`);
      console.log(`Attempts: ${job.attempts}/${job.max_retries}`);
      console.log(`Created: ${formatIST(job.created_at)}`);
      console.log(`Updated: ${formatIST(job.updated_at)}`);
      console.log(chalk.cyan('--- Logs ---\n'));

      let lastCount = 0;

      const printLogs = () => {
        const logs = queue.getJobLogs(argv.jobId);
        if (!logs || logs.length === 0) {
          if (!argv.follow) console.log('(no logs found)');
          return;
        }

        const newLogs = logs.slice(lastCount);
        newLogs.forEach((l) => {
          const ts = formatIST(l.created_at);
          let msg = l.log_output || '';

          if (msg.startsWith('[stderr]')) {
            msg = chalk.red(msg);
          } else if (msg.includes('✅') || msg.includes('📤')) {
            msg = chalk.green(msg);
          } else if (msg.includes('❌') || msg.includes('⚠️')) {
            msg = chalk.yellow(msg);
          } else {
            msg = chalk.white(msg);
          }

          console.log(`[${chalk.gray(ts)}] ${msg}`);
        });
        lastCount = logs.length;
      };

      // Print initial logs
      printLogs();

      if (argv.follow) {
        console.log(chalk.gray('\n⏳ Following logs... (Ctrl+C to stop)\n'));
        const interval = setInterval(() => {
          printLogs();
        }, 1000);

        process.on('SIGINT', () => {
          clearInterval(interval);
          console.log(chalk.gray('\n🛑 Stopped following logs.'));
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    } catch (err) {
      console.error('❌ Error fetching logs:', err.message);
      process.exit(1);
    }
  }
)

  // ---------- METRICS ----------

  .command(
  'metrics',
  'Show queue performance metrics',
  () => {},
  () => {
    try {
      const summary = db.prepare(`
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN state='timeout' THEN 1 ELSE 0 END) AS timeouts,
          ROUND(AVG(duration), 2) AS avg_duration
        FROM job_metrics
      `).get();

      console.log("\n📊 Queue Performance Summary:");
      console.table(summary);

      const recent = db.prepare(`
        SELECT job_id, command, state, duration, completed_at
        FROM job_metrics
        ORDER BY completed_at DESC
        LIMIT 5
      `).all();

      console.log("\n🕓 Recent Job Executions:");
      console.table(recent);
    } catch (err) {
      console.error("❌ Failed to load metrics:", err.message);
    }
  }
)


  // ---------- CONFIG ----------
  .command(
    "config <action> [key] [value]",
    "Get or set config values",
    (y) =>
      y.positional("action", {
        choices: ["get", "set"],
        describe: "Get or set config value",
      })
      .positional("key", {
        type: "string",
        describe: "Config key (e.g. backoff_base, max_retries)",
      })
      .positional("value", {
        type: "string",
        describe: "Value to set (for set only)",
      }),
    (argv) => {
      if (argv.action === "get") {
        if (!argv.key) {
          console.error("Please provide a config key to get.");
          process.exit(1);
        }
        const val = cfg.getConfig(argv.key);
        if (val === undefined || val === null) {
          console.log(`Config '${argv.key}' not set.`);
        } else {
          console.log(`${argv.key} = ${val}`);
        }
        process.exit(0);
      } else if (argv.action === "set") {
        if (!argv.key || argv.value === undefined) {
          console.error("Please provide both key and value to set.");
          process.exit(1);
        }
        cfg.setConfig(argv.key, argv.value);
        console.log(`Config '${argv.key}' set to '${argv.value}'.`);
        process.exit(0);
      }
    }
  )

  .demandCommand(1, "Please provide a valid command.")
  .help()
  .strict() // disallow unknown commands
  .parse();

