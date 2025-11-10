#!/bin/bash
# ============================================================
# 🚀 QueueCTL — Universal Setup & Test Script
# Author: Nehil Sahu
# Description: Auto setup for Core + Backend + Frontend + Job Testing
# ============================================================

echo ""
echo "=============================================="
echo " ⚙️  Starting QueueCTL Setup & Test Workflow..."
echo "=============================================="
sleep 1

ROOT_DIR=$(pwd)

# --- CORE SETUP (CLI + Worker + Queue) ---
echo ""
echo "🧠 Setting up Core..."
cd "$ROOT_DIR" || { echo "❌ Root folder missing!"; exit 1; }
npm install --silent || { echo "❌ Core install failed!"; exit 1; }
echo "✅ Core setup complete."

# --- BACKEND SETUP ---
echo ""
echo "🧱 Setting up Backend..."
cd "$ROOT_DIR/Backend" || { echo "❌ Backend folder missing!"; exit 1; }
npm install --silent || { echo "❌ Backend install failed!"; exit 1; }

pkill -f "node app.js" >/dev/null 2>&1
nohup node app.js > "$ROOT_DIR/backend.log" 2>&1 &
BACK_PID=$!
sleep 3
echo "✅ Backend running at http://localhost:8080 (PID: $BACK_PID)"

# --- FRONTEND SETUP ---
echo ""
echo "🎨 Setting up Frontend..."
cd "$ROOT_DIR/Frontend" || { echo "❌ Frontend folder missing!"; exit 1; }
npm install --silent || { echo "❌ Frontend install failed!"; exit 1; }

pkill -f "vite" >/dev/null 2>&1
nohup npm run dev > "$ROOT_DIR/frontend.log" 2>&1 &
FRONT_PID=$!
sleep 5
echo "✅ Frontend running at http://localhost:5173 (PID: $FRONT_PID)"

# --- JOB ENQUEUE ---
echo ""
echo "🧩 Enqueuing sample jobs..."
cd "$ROOT_DIR/src" || { echo "❌ Root folder missing!"; exit 1; }
node cli.js enqueue '{"command":"echo Hello from QueueCTL!"}'
node cli.js enqueue '{"command":"sleep 2 && echo Job 2 done!"}'
node cli.js enqueue '{"command":"false"}'
sleep 1
echo "✅ Jobs enqueued successfully."

# --- JOB LIST ---
echo ""
echo "📋 Current Jobs:"
node cli.js list

# --- WORKER START ---
echo ""
echo "⚙️ Starting 2 workers in background..."
nohup node cli.js worker start -c 2 > "$ROOT_DIR/worker.log" 2>&1 &
WORKER_PID=$!
sleep 3
echo "✅ Workers running in background (PID: $WORKER_PID)"

# --- SHOW WORKER IDS ---
sleep 2
echo ""
echo "🔍 Detecting Worker IDs..."
WORKER_IDS=$(grep -o "worker-[0-9]*-[a-z0-9]*-[0-9]*" "$ROOT_DIR/worker.log" | sort | uniq)

if [ -z "$WORKER_IDS" ]; then
  echo "⚠️ No worker IDs found yet (workers may still be starting)."
else
  echo "🧠 Active Worker IDs:"
  echo "$WORKER_IDS" | while read -r wid; do
    echo "   • $wid"
  done
fi

# --- WAIT FOR JOB COMPLETION ---
echo ""
echo "⏳ Waiting for workers to process jobs..."
MAX_WAIT=30
CHECK_INTERVAL=3
TIME_PASSED=0

while [ $TIME_PASSED -lt $MAX_WAIT ]; do
  pending=$(node cli.js list | grep -c "pending")
  processing=$(node cli.js list | grep -c "processing")
  waiting=$(node cli.js list | grep -c "waiting")

  if [ $pending -eq 0 ] && [ $processing -eq 0 ] && [ $waiting -eq 0 ]; then
    echo "✅ All jobs have finished processing!"
    break
  fi

  echo "🕒 Still processing... (${TIME_PASSED}s elapsed)"
  sleep $CHECK_INTERVAL
  TIME_PASSED=$((TIME_PASSED + CHECK_INTERVAL))
done

if [ $TIME_PASSED -ge $MAX_WAIT ]; then
  echo "⚠️ Timeout reached (some jobs may still be processing)."
fi

# --- METRICS SUMMARY ---
echo ""
echo "📊 Queue Metrics Summary:"
node cli.js metrics


# --- SUMMARY ---
echo ""
echo "=============================================="
echo " ✅ QueueCTL test completed successfully!"
echo " 🌐 Dashboard: http://localhost:5173"
echo " ⚙️ API:       http://localhost:8080"
echo ""
echo " 🧠 Logs saved at:"
echo "    • backend.log"
echo "    • frontend.log"
echo "    • worker.log"
echo ""
if [ -n "$WORKER_IDS" ]; then
  echo " 🧠 Active Worker IDs:"
  echo "$WORKER_IDS" | while read -r wid; do
    echo "    • $wid"
  done
fi
echo ""
echo " 💡 Stop all with:"
echo "    kill $BACK_PID $FRONT_PID $WORKER_PID"
echo "=============================================="
