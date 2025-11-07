const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'queue.sqlite');
if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, dbPath + '.bak');
  fs.unlinkSync(dbPath);
  console.log('Backed up and removed', dbPath);
} else {
  console.log('DB not found at', dbPath);
}