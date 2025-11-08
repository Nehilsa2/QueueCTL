#!/usr/bin/env node
import chalk from "chalk";
import Table from "cli-table3";

import db from './db.js'

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

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as queue from './queue.js';
import { WorkerManager } from './worker.js';
import * as cfg from './config.js';




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
  "dlq <action>",
  "Dead Letter Queue operations",
  (y) => y.positional("action", { choices: ["list", "retry"], describe: "List or retry dead jobs" }),
  (argv) => {
    if (argv.action === "list") {
      const jobs = queue.listDeadJobs();
      if (jobs.length === 0) console.log("🪦 DLQ empty.");
      else console.table(jobs.map(j => ({ id: j.id, command: j.command, attempts: j.attempts })));
      process.exit(0);
    }
  }
)
.command(
    'list',
    'List all jobs or filter by state',
    (y) => {
      y.option('state', {
        describe: 'Filter jobs by state (pending, processing, completed, failed, dead)',
        type: 'string',
      });
    },
    (argv) => {
      const { state } = argv;
      try {
        let jobs;
        if (state) {
          jobs = queue.listParticularJobs(state);
          if (jobs.length === 0) {
            console.log(`⚠️  No jobs found with state '${state}'`);
            return;
          }
        } else {
          jobs = queue.listAllJobs();
          if (jobs.length === 0) {
            console.log("🗃️ No jobs found in the queue");
            return;
          }
        }

        // Create a formatted table with all job details
        const table = new Table({
          head: [
            chalk.cyan("ID"),
            chalk.cyan("Command"),
            chalk.cyan("State"),
            chalk.cyan("Attempts"),
            chalk.cyan("Max Retries"),
            chalk.cyan("Created At"),
            chalk.cyan("Update at"),
            chalk.cyan("run at")
          ],
          wordWrap: true,
          colWidths: [15, 25, 12, 10, 12, 25]
        });

        // Add jobs to table
        jobs.forEach(job => {
          table.push([
            job.id,
            job.command,
            chalk[getStateColor(job.state)](job.state),
            `${job.attempts}`,
            `${job.max_retries}`,
            job.created_at,
            job.updated_at,
            job.run_at
          ]);
        });

        console.log(table.toString());
      } catch (err) {
        console.error("❌ Error listing jobs:", err.message);
      }
    }
  )

  // ---------- LOGS ----------
  .command(
    'logs <jobId>',
    'Show logs for a job',
    (y) => y.positional('jobId', { type: 'string', describe: 'Job id' }),
    (argv) => {
      try {
        const job = queue.getJob(argv.jobId);
        if (!job) {
          console.error(`No job found with id '${argv.jobId}'`);
          process.exit(1);
        }

        // Print basic job info
        console.log(chalk.bold(`Job: ${job.id}`));
        console.log(`Command: ${job.command}`);
        console.log(`State: ${job.state}`);
        console.log(`Attempts: ${job.attempts}/${job.max_retries}`);
        console.log(`Created: ${job.created_at}`);
        console.log(`Updated: ${job.updated_at}`);
        console.log('--- Logs ---');

        const logs = queue.getJobLogs(argv.jobId) || [];
        if (logs.length === 0) {
          console.log('(no logs found)');
          process.exit(0);
        }

        logs.forEach(l => {
          const ts = l.created_at || l.createdAt || '';
          console.log(`[${ts}] ${l.log_output}`);
        });

      } catch (err) {
        console.error('Error fetching logs:', err.message);
        process.exit(1);
      }
    }
  )

  //metrics

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
