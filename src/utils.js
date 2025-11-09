import { v4 as uuidv4 } from 'uuid';

export function nowIso() {
  return new Date().toISOString();
}

export function delayMs(seconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, seconds * 1000)));
}

export function formatIST(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export { uuidv4 };
