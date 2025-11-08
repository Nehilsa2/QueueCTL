import db from '../src/db.js';

try {
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='job_logs'").get();
  if (!tbl) {
    console.log('job_logs table: MISSING');
  } else {
    console.log('job_logs table: PRESENT');
    try {
      const count = db.prepare('SELECT COUNT(*) AS c FROM job_logs').get().c;
      console.log('rows:', count);
      const rows = db.prepare('SELECT * FROM job_logs ORDER BY created_at DESC LIMIT 5').all();
      console.log('sample rows:');
      console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
      console.log('error querying job_logs:', e.message);
    }
  }
} finally {
  db.close();
}