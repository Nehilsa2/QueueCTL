import { useEffect, useState } from "react";
import { RefreshCw, Trash2, Play, Settings } from "lucide-react";
import {
  fetchStatus,
  fetchJobs,
  fetchMetrics,
  resetQueue,
} from "../api.js";

export default function Dashboard() {
  const [summary, setSummary] = useState({ by_state: {}, active_workers: 0 });
  const [jobs, setJobs] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [lastUpdated, setLastUpdated] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 🔄 Fetch backend data
  const loadData = async () => {
    try {
      const [statusRes, jobsRes, metricsRes] = await Promise.all([
        fetchStatus(),
        fetchJobs(),
        fetchMetrics(),
      ]);
      setSummary(statusRes.data);
      setJobs(jobsRes.data);
      setMetrics(metricsRes.data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Fetch failed", err);
    }
  };

  // 🧠 Auto-refresh logic
  useEffect(() => {
    loadData();
    if (autoRefresh) {
      const interval = setInterval(loadData, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // 🧹 Reset queue
  const handleReset = async () => {
    await resetQueue();
    loadData();
  };

  // 🎨 State colors
  const stateColors = {
    pending: "bg-yellow-500/20 border-yellow-400/30",
    processing: "bg-blue-500/20 border-blue-400/30",
    completed: "bg-green-500/20 border-green-400/30",
    failed: "bg-red-500/20 border-red-400/30",
    dead: "bg-gray-500/20 border-gray-400/30",
    workers: "bg-purple-500/20 border-purple-400/30",
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200 p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <span className="text-[#58a6ff]">QueueCTL Dashboard</span>
          </h1>
          <p className="text-gray-400 text-sm">
            Monitor background jobs, workers, and queue health in real-time
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">
            ● Last updated: {lastUpdated}
          </span>
          <button
            className={`px-3 py-1 rounded-md border flex items-center gap-1 ${
              autoRefresh
                ? "bg-green-500/20 border-green-400"
                : "border-gray-500"
            }`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Play size={16} /> Auto-refresh
          </button>
          <button
            onClick={loadData}
            className="px-3 py-1 rounded-md border border-gray-600 flex items-center gap-1 hover:bg-gray-800"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1 rounded-md border border-red-600 text-red-400 flex items-center gap-1 hover:bg-red-500/20"
          >
            <Trash2 size={16} /> Reset Queue
          </button>
          <button className="p-2 border border-gray-700 rounded-md hover:bg-gray-800">
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-8">
        {["pending", "processing", "completed", "failed", "dead", "workers"].map(
          (state, i) => (
            <div
              key={i}
              className={`p-4 rounded-xl border ${
                stateColors[state]
              } backdrop-blur-sm shadow-md`}
            >
              <h2 className="text-sm font-semibold mb-1 uppercase text-gray-400">
                {state === "dead" ? "DEAD (DLQ)" : state}
              </h2>
              <p className="text-3xl font-bold text-white">
                {state === "workers"
                  ? summary.active_workers
                  : summary.by_state[state] || 0}
              </p>
            </div>
          )
        )}
      </div>

      {/* Jobs and Metrics Section */}
      <div className="grid grid-cols-3 gap-6">
        {/* Jobs Table */}
        <div className="col-span-2 bg-[#161b22] p-4 rounded-xl border border-gray-800">
          <h3 className="text-lg font-semibold mb-3">Jobs ({jobs.length})</h3>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left p-2">Job ID</th>
                <th className="text-left p-2">Command</th>
                <th className="text-left p-2">State</th>
                <th className="text-left p-2">Attempts</th>
                <th className="text-left p-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 10).map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-gray-800 hover:bg-gray-800/40"
                >
                  <td className="p-2 text-[#58a6ff]">{job.id}</td>
                  <td className="p-2">{job.command}</td>
                  <td className="p-2 capitalize">{job.state}</td>
                  <td className="p-2">
                    {job.attempts}/{job.max_retries}
                  </td>
                  <td className="p-2 text-gray-400">
                    {job.updated_at?.split("T")[0]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Metrics and Activity */}
        <div className="space-y-6">
          <div className="bg-[#161b22] p-4 rounded-xl border border-gray-800">
            <h3 className="text-lg font-semibold mb-3">Performance Metrics</h3>
            <div className="text-sm space-y-1 text-gray-300">
              <p>Total Jobs: {metrics?.metrics?.total_jobs || 0}</p>
              <p>Completed: {metrics?.metrics?.completed || 0}</p>
              <p>Failed: {metrics?.metrics?.failed || 0}</p>
              <p>Avg Duration: {metrics?.metrics?.avg_duration || 0}s</p>
            </div>
          </div>

          <div className="bg-[#161b22] p-4 rounded-xl border border-gray-800">
            <h3 className="text-lg font-semibold mb-3">Recent Activity</h3>
            <ul className="text-sm text-gray-300 space-y-1">
              {metrics?.recent?.slice(0, 5)?.map((m) => (
                <li key={m.job_id}>
                  <span className="text-[#58a6ff]">{m.job_id}</span> → {m.state}{" "}
                  ({m.duration}s)
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
