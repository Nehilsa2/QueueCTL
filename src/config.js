const { UPDATE } = require('sequelize/lib/query-types');
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
if (getConfig('job_timeout') === null) setConfig('job_timeout', '300'); // 5 minutes default timeout

module.exports = { setConfig, getConfig };
