//to generate the random job id
const { v4: uuidv4 } = require('uuid');

function nowIso() {
  return new Date().toISOString();
}

function delayMs(seconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, seconds*1000)));
}

module.exports = { uuidv4, nowIso, delayMs };
