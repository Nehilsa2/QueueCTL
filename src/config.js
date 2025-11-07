const db = require('./db');

function setConfig(key, value) {
  const stmt = db.prepare(`INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  stmt.run(key, String(value));
}

function getConfig(key, fallback=null) {
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
  return row ? row.value : fallback;
}

// default values
if (getConfig('max_retries') === null) setConfig('max_retries', '3');
if (getConfig('backoff_base') === null) setConfig('backoff_base', '2');

module.exports = { setConfig, getConfig };
