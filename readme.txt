
#  QueueCTL — CLI-based Background Job Queue System

`queuectl` **is a Node.js-based background job queue** that lets you add, manage, and run background jobs with retries, persistence, and a Dead Letter Queue (DLQ). It supports background workers, exponential backoff, configurable retry counts, job timeouts, and optional features such as job priorities, delayed jobs, metrics, and dashboards.

---

## 🚀 Features

* Persistent job storage (SQLite)
* Multiple worker processes
* Automatic retries with exponential backoff
* Separate **Dead Letter Queue (DLQ)** table
* Configurable retry & backoff base
* Background **daemon mode** with PID management
* Graceful shutdown
* Additional features:
   * Web Dashboard & API Endpoints
   * Job Scheduling
   * Job Priority
   * Job output logging
   * Daemon Mode
   * Job timeout handling


---

## ⚙️ Installation

```bash
git clone https://github.com/MayankSahu1005/QueueCTL.git
cd QueueCTL
npm install
```

---

## 🧩 Making `queuectl` a Global CLI Command

To run commands directly like `queuectl enqueue job.json` instead of `npm run queuectl`, follow these steps:


Run this in your project root:

```bash
npm install -g .
```

###  Verify

```bash
queuectl --help
```

You should now be able to run all commands directly:

```bash
queuectl enqueue job.json
queuectl worker start --count 2 --daemon
queuectl status
queuectl dlq list
```

To update after code changes:

```bash
npm install -g .
```

---

## 🧩 CLI Commands Overview

| Command                                           | Description                          |
| --------------------------------------------------| ------------------------------------ |
| `queuectl enqueue <json or file>`                 | Add a new job                        |
| `queuectl enqueue <json or file> [--run-at Time]` | Schedule the new job                 |
| `queuectl enqueue <json or file> [--priority P]`  | Add New job with Priority            |
| `queuectl enqueue <json or file> [--delay D]`     | Add New job with Delay               |
| `queuectl worker start [--count N] [--daemon]`    | Start workers (optional daemon mode) |
| `queuectl worker stop`                            | Stop background workers              |
| `queuectl status`                                 | Show system/job status               |
| `queuectl list [--state STATE]`                   | List jobs by state                   |
| `queuectl dlq list`                               | View DLQ                             |
| `queuectl dlq retry <id>`                         | Retry DLQ job                        |
| `queuectl config set/get`                         | Manage configuration                 |



---

## 🧩 Usage Examples

### ▶️ Enqueue a job (inline JSON)

```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}'
```
### ▶️ Scheduling a job 
Scheduling at fixed Time
```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}' --run-at 2025-11-08T11:08:30.932Z
```
Scheduling with delay in seconds
```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}' --delay 10
```
### ▶️ Enqueue a job with pirority
priority is an integer, higher the value higher the priority

```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}' --priority 100
```

### ▶️ Enqueue from a JSON file

`job.json`:

```json
{
  "id": "job1",
  "command": "echo Hello && exit 0",
  "max_retries": 3,
  "timeout": 10000
}
```

Run:

```bash
queuectl enqueue job.json
```

---

### ▶️ Start Workers

```bash
queuectl worker start --count 2
```

Start worker in background:

```bash
queuectl worker start --count 2 --daemon
```

Stop workers:

```bash
queuectl worker stop
```

---

### ▶️ Status

```bash
queuectl status
```

### ▶️ DLQ Management

```bash
queuectl dlq list
queuectl dlq retry job1

```

### ▶️ Config

```bash
queuectl config set backoff_base 2
queuectl config get max_retries
```

---

## 🔄 Retry & Backoff Logic

```
delay = backoff_base ^ attempts
```

| Attempt | Delay (seconds) |
| ------- | --------------- |
| 1       | 2               |
| 2       | 4               |
| 3       | 8               |

After exceeding `max_retries`, job is moved to **DLQ**.

---

## ⏱ Timeout Handling

Each job has a timeout (default 30s). If exceeded, job is terminated and retried.

```json
{
  "id": "job2",
  "command": "sleep 60",
  "timeout": 5000
}
```

---


## 🌐 Web Dashboard

The `queuectl` dashboard provides a simple interface to monitor jobs, failed jobs (DLQ), metrics, and worker status.

Start dashboard:

```bash
node server.js
```

Open in browser:

```
http://localhost:4000
```

Dashboard shows:

* Active Jobs
* Dead Letter Queue
* Worker Status

---

##  API Endpoints

| Endpoint         | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| **GET /jobs**    | Lists all active jobs from the `jobs` table.                             |
| **GET /dlq**     | Lists all permanently failed jobs from the DLQ table.                    |
| **GET /workers** | Shows worker daemon status by checking PID file.                         |
| **GET /metrics** | Shows jobs by States                                                     |

Use these endpoints for monitoring, dashboards, or integration with extern


## 📂 Project Structure

```
queuectl/
├── bin/
│   └── queuectl.js          # CLI entry point
├── lib/
│   ├── db.js                # SQLite setup
│   ├── config.js            # Config helpers
│   ├── cli.js               # CLI logic
│   ├── worker.js            # Job execution + retry logic
│   ├── workerManager.js     # Worker pool management
├── data/
│   ├── queue.db             # SQLite DB
│   ├── worker.log           # Daemon logs
│   └── worker.pid           # PID for daemon workers
├── migrate.js               # Schema migration helper
├── server.js               # Web Dashboard and Endpoints
└── README.md
```

---
