#!/usr/bin/env node
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const queue = require("./queue");
const { WorkerManager } = require("./worker");

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
      else console.table(jobs.map(j => ({ id: j.id, command: j.command, attempts: j.attempts, error: j.last_error })));
      process.exit(0);
    }
  }
)
.command(
  "list [state]",
  "List jobs (optionally filter by state)",
  (y) => y.positional("state", {
    type: "string",
    describe: "Filter by job state (pending, processing, completed, failed, dead)",
  }),
  (argv) => {
    let rows;
    if (argv.state) {
      const stmt = queue.db.prepare(`SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC`);
      rows = stmt.all(argv.state);
    } else {
      rows = queue.listAllJobs();
    }

    if (rows.length === 0) {
      console.log("🗃️ No jobs found.");
    } else {
      console.table(rows.map(j => ({
        id: j.id,
        command: j.command,
        state: j.state,
        attempts: j.attempts,
        max_retries: j.max_retries,
        created_at: j.created_at,
        updated_at: j.updated_at,
        last_error: j.last_error
      })));
    }
    process.exit(0);
  }
)
  .command(
    "Update <config>",
    "changes the backoff and max retries values"
    
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
      const config = require("./config");
      if (argv.action === "get") {
        if (!argv.key) {
          console.error("Please provide a config key to get.");
          process.exit(1);
        }
        const val = config.getConfig(argv.key);
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
        config.setConfig(argv.key, argv.value);
        console.log(`Config '${argv.key}' set to '${argv.value}'.`);
        process.exit(0);
      }
    }
  )

  .demandCommand(1, "Please provide a valid command.")
  .help()
  .strict() // disallow unknown commands
  .parse();
