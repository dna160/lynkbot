#!/usr/bin/env bash
# Start the LynkBot background worker (BullMQ job processor).
# Builds bundle if needed, kills any prior instance, starts fresh.
set -uo pipefail

ROOT="/Users/storytellers/Documents/Claude Home/Lynkbot"
LOG="/tmp/lynkbot-worker.log"
PIDFILE="/tmp/lynkbot-worker.pid"
BUNDLE="$ROOT/apps/worker/dist/bundle.js"

# --- Kill prior instance ---
if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE" 2>/dev/null || true)
  [ -n "$OLDPID" ] && kill -9 "$OLDPID" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
pkill -9 -f "lynkbot.*worker\|worker.*bundle" 2>/dev/null || true
sleep 1

# --- Build bundle ---
bash "$ROOT/scripts/build-worker.sh"

# --- Source env ---
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env"
  set +a
fi

# --- Start worker ---
# NODE_PATH lets Node resolve pnpm-hoisted packages (tiktoken, pdf-parse)
# that esbuild marks as external but pnpm doesn't symlink to root node_modules.
: > "$LOG"
cd "$ROOT"
NODE_PATH="$ROOT/node_modules/.pnpm/node_modules" nohup node "$BUNDLE" >> "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"
echo "Worker starting (PID $PID, log $LOG)"

# --- Wait for startup confirmation ---
DEADLINE=$((SECONDS + 20))
while [ $SECONDS -lt $DEADLINE ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Worker process died:" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  if grep -q "LynkBot Worker started" "$LOG" 2>/dev/null; then
    echo "Worker ready (PID $PID)"
    tail -3 "$LOG"
    exit 0
  fi
  sleep 1
done

echo "Worker did not confirm startup within 20s:" >&2
tail -20 "$LOG" >&2
exit 1
