#!/usr/bin/env bash
# scripts/demo.sh
set -e
echo "enqueueing a successful job (echo hi)..."
node src/cli.js enqueue '{"command":"echo Hello from job","id":"job-success-1","max_retries":2}'
echo "enqueueing a failing job (exit 2)..."
node src/cli.js enqueue '{"command":"bash -c \"exit 2\"","id":"job-fail-1","max_retries":2}'
echo "starting a single worker in background..."
node src/cli.js worker start --count 1 &
WORKER_PID=$!
sleep 6
echo "status after some time:"
node src/cli.js status
echo "listing dead jobs (if any):"
node src/cli.js dlq list
echo "killing worker (SIGINT)"
kill -INT $WORKER_PID || true
wait $WORKER_PID 2>/dev/null || true
echo "done demo"
