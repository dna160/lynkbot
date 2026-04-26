#!/usr/bin/env bash
# Canonical LynkBot API startup. Idempotent: safe to run repeatedly.
# Uses pre-bundled apps/api/dist/bundle.js (esbuild output) — fast cold start.
# To rebuild the bundle after editing source, run scripts/build-api.sh first.
set -uo pipefail

ROOT="/Users/storytellers/Documents/Claude Home/Lynkbot"
LOG="/tmp/lynkbot-api.log"
PIDFILE="/tmp/lynkbot-api.pid"
PORT="${PORT:-3000}"
BUNDLE="$ROOT/apps/api/dist/bundle.js"

cd "$ROOT" || exit 1

if [ ! -f "$BUNDLE" ]; then
  echo "ERROR: bundle not found at $BUNDLE — run scripts/build-api.sh first" >&2
  exit 1
fi

# --- Kill any prior instance ---
if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE" 2>/dev/null || true)
  [ -n "$OLDPID" ] && kill -9 "$OLDPID" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
pkill -9 -f "lynkbot-api-bundle"   2>/dev/null || true
pkill -9 -f "apps/api/dist/bundle" 2>/dev/null || true
pkill -9 -f "apps/api/dist/index"  2>/dev/null || true
pkill -9 -f "tsx.*apps/api/src"    2>/dev/null || true
HOLDERS=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
[ -n "$HOLDERS" ] && echo "$HOLDERS" | xargs -r kill -9 2>/dev/null || true
sleep 1

# --- Source env ---
if [ ! -f .env ]; then
  echo "ERROR: .env missing in $ROOT" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
export PORT

# --- Launch bundle ---
: > "$LOG"
nohup node "$BUNDLE" >> "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"
echo "API starting (PID $PID, log $LOG)"

# --- Wait for /health (60s budget — first cold start can be slow due to JIT) ---
DEADLINE=$((SECONDS + 60))
while [ $SECONDS -lt $DEADLINE ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "API process died during startup. Last log lines:" >&2
    tail -50 "$LOG" >&2
    exit 1
  fi
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 \
         "http://localhost:$PORT/health" 2>/dev/null || true)
  if [ "$CODE" = "200" ]; then
    UPTIME=$((60 - (DEADLINE - SECONDS)))
    echo "API healthy on port $PORT (PID $PID, ${UPTIME}s)"
    exit 0
  fi
  sleep 1
done

echo "API did not become healthy within 60s. Last log lines:" >&2
tail -60 "$LOG" >&2
exit 1
