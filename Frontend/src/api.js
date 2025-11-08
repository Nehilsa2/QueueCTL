import axios from "axios";

export const API = axios.create({
  baseURL: "http://localhost:8080/api", // backend URL
  timeout: 8000,
});

// Helper calls
export const fetchStatus = () => API.get("/status");
export const fetchJobs = (state = "") =>
  API.get(state ? `/jobs?state=${state}` : "/jobs");
export const fetchMetrics = () => API.get("/metrics");
export const fetchJobDetails = (id) => API.get(`/jobs/${id}`);
export const retryJob = (id) => API.post(`/dlq/retry/${id}`);
export const deleteJob = (id) => API.delete(`/jobs/${id}`);
export const resetQueue = () => API.post("/reset");
