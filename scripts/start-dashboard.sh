#!/usr/bin/env bash
# Start the LynkBot dashboard dev server.
# Kills any prior Vite process, starts fresh on port 8080.
set -uo pipefail

ROOT="/Users/storytellers/Documents/Claude Home/Lynkbot"
DASH="$ROOT/apps/dashboard"
LOG="/tmp/lynkbot-dashboard.log"
PIDFILE="/tmp/lynkbot-dash.pid"
PORT=8080

# --- Kill prior ---
if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE" 2>/dev/null || true)
  [ -n "$OLDPID" ] && kill -9 "$OLDPID" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
pkill -9 -f "vite.*dashboard\|vite.*8080\|vite.*5173\|vite.*5182" 2>/dev/null || true
HOLDERS=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
[ -n "$HOLDERS" ] && echo "$HOLDERS" | xargs -r kill -9 2>/dev/null || true
sleep 1

cd "$DASH" || exit 1

# --- Source env for VITE_ vars ---
if [ -f "$ROOT/.env" ]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^#|^$ ]] && continue
    [[ "$key" =~ ^VITE_ ]] && export "$key=$val"
  done < "$ROOT/.env"
fi

: > "$LOG"
nohup node node_modules/.bin/vite \
  --config vite.config.mjs \
  --host 127.0.0.1 \
  --port "$PORT" \
  --strictPort \
  >> "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"
echo "Dashboard starting (PID $PID, log $LOG)"

# --- Wait for HTTP ready (Vite cold-start can take 60s on first run) ---
DEADLINE=$((SECONDS + 90))
while [ $SECONDS -lt $DEADLINE ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Dashboard process died:" >&2; tail -20 "$LOG" >&2; exit 1
  fi
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  if [ "$CODE" = "200" ]; then
    echo "Dashboard ready → http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done
echo "Dashboard did not respond within 90s:" >&2; tail -20 "$LOG" >&2; exit 1
