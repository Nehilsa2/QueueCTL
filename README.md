<h1 align="center">🚀 QueueCTL — Lightweight Node.js Job Queue System</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20.x-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/SQLite3-Persistent_Storage-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Queue-Management-orange?style=for-the-badge" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&pause=2000&color=58A6FF&width=600&lines=🔥+Feature-Rich+Job+Queue+with+Retries+and+DLQ;⚙️+Real-Time+Monitoring+via+Dashboard;💾+SQLite+Backed+and+CLI+Controlled" alt="Typing SVG" />
</p>

---

## ⚙️ **Setup & Installation**

### 🧩 Clone the repository
```bash
git clone https://github.com/<your-username>/queuectl.git
cd queuectl
```

### 📦 Install dependencies
```bash
npm install
```

### ▶️ Start the backend server
```bash
node app.js
```

### 💻 Start the frontend dashboard
```bash
cd dashboard
npm install
npm run dev
```
Visit 👉 **http://localhost:5173**

### 🧠 Use the CLI globally
```bash
npm link
queuectl --help
```

---

## 💡 **Usage Examples**

### ✅ Enqueue a job
```bash
queuectl enqueue '{"command":"echo Hello Queue"}'
```

### 🧵 Start workers
```bash
queuectl worker start -c 3
```

### 📋 List jobs
```bash
queuectl list
```

### 🪦 Manage Dead Letter Queue
```bash
queuectl dlq list
queuectl dlq retry
queuectl dlq clear
```

### ⚙️ Configure queue behavior
```bash
queuectl config set max_retries 5
queuectl config set backoff_base 3
queuectl config get job_timeout
```

---

## 🧱 **Architecture Overview**

```mermaid
flowchart TD
  subgraph CLI [CLI Commands]
  A[enqueue] -->|Add job| B[Jobs Table]
  C[worker start] -->|Process job| D[Worker Loop]
  E[dlq retry] --> B
  end

  subgraph Backend [Express API]
  B -->|REST| F[/api/jobs/]
  F -->|Returns JSON| G[React Dashboard]
  end

  subgraph Database [SQLite Persistence]
  B[(jobs)] --> H[(job_logs)]
  B --> I[(job_metrics)]
  end

  D -->|executes| H
  D -->|updates| I
```

---

## ⚙️ **Job Lifecycle**

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> processing: picked by worker
    processing --> completed: success
    processing --> waiting: retry scheduled
    waiting --> pending: backoff expires
    processing --> dead: retries exhausted
    completed --> [*]
    dead --> [*]
```

---

## 🧩 **Core Components**

| File | Description |
|------|--------------|
| `db.js` | SQLite3 schema and migrations |
| `queue.js` | Handles enqueue, DLQ, retries, waiting state |
| `worker.js` | Worker lifecycle, metrics, retries |
| `cli.js` | CLI management tool |
| `config.js` | Persistent runtime configs |
| `dashboard/` | React + Tailwind + Framer Motion dashboard |

---

## 🧠 **Architecture Highlights**

- 💾 SQLite-backed persistence  
- 🔁 Retry mechanism with exponential backoff  
- 🪦 Dead Letter Queue for failed jobs  
- 🧠 Automatic job reactivation  
- 🧰 Persistent logs and metrics  
- 🎨 Dashboard with animations and live refresh  

---

## 📊 **Dashboard Features**

- Realtime job monitoring  
- Scrollable job table (sticky header)  
- Hover effects & animations  
- Auto-refresh toggle + manual refresh  
- State icons:  
  ⏳ *Pending* | 🔄 *Processing* | ⏸ *Waiting* | ⚠️ *Failed* | 💀 *Dead* | ✅ *Completed*  

---

## 🧪 **Testing Instructions**

### 1️⃣ Enqueue jobs
```bash
queuectl enqueue '{"command":"sleep 2 && echo Done"}'
```

### 2️⃣ Start workers
```bash
queuectl worker start -c 2
```

### 3️⃣ Verify dashboard
Visit **http://localhost:5173**

✅ Observe live transitions → Pending → Processing → Completed  
🌀 Processing state spins  
💀 Dead + ⏸ Waiting appear dynamically  

### 4️⃣ Test DLQ behavior
```bash
queuectl enqueue '{"command":"false"}'
queuectl dlq list
queuectl dlq retry
```

---

## ⚖️ **Assumptions & Design Choices**

| Category | Choice | Reason |
|-----------|---------|--------|
| DB | SQLite3 | Lightweight and persistent |
| Retries | Exponential | Prevents quick re-fail loops |
| DLQ | Dedicated `dead` state | Safe manual recovery |
| Config | Stored in DB | CLI controlled |
| Workers | In-process | Simpler lifecycle |
| Dashboard | Poll-based | Stable real-time UX |

---

## 🧰 **Developer Commands**

| Command | Description |
|----------|-------------|
| `queuectl enqueue <json>` | Add a new job |
| `queuectl list` | List all jobs |
| `queuectl worker start -c N` | Start N workers |
| `queuectl dlq list` | List DLQ jobs |
| `queuectl dlq retry` | Retry DLQ jobs |
| `queuectl logs <id>` | View logs for a job |
| `queuectl metrics` | Show job metrics |
| `queuectl config set key value` | Change runtime config |

---

## 🧩 **Test Samples**

| Type | Command | Expected Result |
|------|----------|-----------------|
| Success | `queuectl enqueue '{"command":"echo Hello"}'` | ✅ Completed |
| Retry | `queuectl enqueue '{"command":"false"}'` | 🔁 Retries → Dead |
| Long Job | `queuectl enqueue '{"command":"sleep 5 && echo Done"}'` | 🕐 Processing |
| Scheduled | `queuectl enqueue '{"command":"echo Future","run_at":"2025-11-09T18:00:00"}'` | ⏰ Scheduled |

---

## 📈 **Performance Metrics**

| Metric | Description |
|---------|-------------|
| `total_jobs` | Unique job count |
| `completed` | Finished successfully |
| `failed` | Failed attempts |
| `waiting` | Waiting for retry |
| `dead` | Permanently failed |
| `avg_duration` | Avg job duration |

---

## 🖥️ **Dashboard Preview**

<p align="center">
  <img src="https://github.com/kentcdodds/kentcdodds.com/raw/main/public/img/hero.gif" width="80%" alt="Dashboard Animation" />
</p>

---

## 🧡 **Built With**

- ⚙️ Node.js + Express  
- 💾 SQLite3  
- 🧠 CLI (yargs + chalk + cli-table3)  
- 🎨 React + TailwindCSS + Framer Motion  

---

## 💬 **Contributing**

1. Fork the repo 🍴  
2. Create a branch (`git checkout -b feature/new`)  
3. Commit your changes (`git commit -m "Added feature"`)  
4. Push (`git push origin feature/new`)  
5. Open a Pull Request 🚀  

---

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&pause=2000&color=00FFAA&width=600&lines=Made+with+❤️+by+Nehil+Sahu;QueueCTL+-+Manage.+Monitor.+Master." />
</p>
