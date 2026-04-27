# LynkBot Local Deployment Runbook

Read this every time before rebuilding or restarting the API, worker, or dashboard.

---

## Architecture Overview

| Process | What it runs | Port |
|---------|-------------|------|
| **API** | `node -r ./run-ts.cjs apps/api/src/index.ts` | 3000 |
| **Worker** | `node -r ./run-ts.cjs apps/worker/src/index.ts` | — |
| **Dashboard** | `node server.mjs` | 8080 |

**No bundler.** TypeScript is transpiled on-the-fly via `run-ts.cjs` (uses `ts.transpileModule()` — pure JS, no esbuild, no spawn, no hang).

---

## Why `run-ts.cjs` (read this once)

esbuild's native binary fails with `spawn ECANCELED` on this machine (macOS env restriction). `tsc --emit` hangs indefinitely due to pnpm symlink traversal during the emit phase. `tsx` also uses esbuild internally and hits the same issue.

`run-ts.cjs` is a Node.js `require()` hook that transpiles `.ts` files using TypeScript's own `transpileModule()` API — no child process, no binary spawn, no file writing. It works reliably.

---

## Step 1 — Compile Workspace Packages

Only needed when `packages/db`, `packages/pantheon`, `packages/ai`, `packages/shared`, `packages/wati`, or `packages/payments` source files have changed.

```bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
bash scripts/build-api.sh
```

The script checks modification timestamps and skips packages whose `dist/` is already newer than `src/`. It takes 2–5 seconds total.

**Force-recompile a specific package:**
```bash
cd packages/db && node_modules/.bin/tsc && cd ../..
cd packages/pantheon && node_modules/.bin/tsc && cd ../..
```

---

## Step 2 — Rebuild Postgres Schema Changes

When `packages/db/src/schema/*.ts` has a new column, run this to add it to the live DB:

```bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
node -e "
const postgres = require('./packages/db/node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL || 'postgresql://lynkbot:localpassword@localhost:5432/lynkbot?sslmode=disable');
// ← paste your ALTER TABLE statement here
sql\`ALTER TABLE buyer_genomes ADD COLUMN IF NOT EXISTS last_signal_extracted_at TIMESTAMPTZ\`
  .then(() => { console.log('done'); return sql.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
"
```

> **Note:** `drizzle-kit push` requires an interactive TTY and will silently do nothing in a background shell. Always use raw SQL via the `postgres` package for schema changes.

---

## Step 3 — Start / Restart the API

```bash
# Kill any running API instance
pkill -f 'run-ts.cjs' 2>/dev/null || pkill -f 'apps/api/dist/bundle.js' 2>/dev/null || true

# Start fresh
nohup /tmp/start-api.sh >> /tmp/lynkbot-api.log 2>&1 &
echo "API PID: $!"
```

### `/tmp/start-api.sh` contents (recreate if /tmp is wiped):

```bash
cat > /tmp/start-api.sh << 'EOF'
#!/bin/bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
set -a
source .env
set +a
export CORS_ORIGIN="http://localhost:8080,http://127.0.0.1:8080"
exec node -r ./run-ts.cjs apps/api/src/index.ts
EOF
chmod +x /tmp/start-api.sh
```

### Check it started:

```bash
# Should show: {"status":"ok",...}
curl -s http://localhost:3000/health

# Watch logs live
tail -f /tmp/lynkbot-api.log
```

---

## Step 4 — Start / Restart the Worker

```bash
pkill -f 'apps/worker' 2>/dev/null || true

cat > /tmp/start-worker.sh << 'EOF'
#!/bin/bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
set -a
source .env
set +a
exec node -r ./run-ts.cjs apps/worker/src/index.ts
EOF
chmod +x /tmp/start-worker.sh

nohup /tmp/start-worker.sh >> /tmp/lynkbot-worker.log 2>&1 &
echo "Worker PID: $!"
```

---

## Step 5 — Start / Restart the Dashboard

```bash
pkill -f 'server.mjs' 2>/dev/null || true

cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
PORT=8080 API_URL=http://localhost:3000 nohup node server.mjs >> /tmp/lynkbot-dash.log 2>&1 &
echo "Dashboard PID: $!"
```

Dashboard serves `apps/dashboard/dist/`. After UI changes, rebuild it:

```bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot/apps/dashboard"
node_modules/.bin/vite build --config vite.config.mjs 2>&1
```

> **Note:** Vite dev server (`vite dev`) may hang on macOS due to the same esbuild issue. Use `node server.mjs` to serve the pre-built `dist/`.

---

## Quick Full Restart (everything at once)

```bash
pkill -f 'run-ts.cjs' 2>/dev/null
pkill -f 'server.mjs' 2>/dev/null
pkill -f 'apps/worker/dist' 2>/dev/null

cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
bash scripts/build-api.sh

# Recreate start scripts if /tmp was cleared
cat > /tmp/start-api.sh << 'EOF'
#!/bin/bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
set -a; source .env; set +a
export CORS_ORIGIN="http://localhost:8080,http://127.0.0.1:8080"
exec node -r ./run-ts.cjs apps/api/src/index.ts
EOF
chmod +x /tmp/start-api.sh

cat > /tmp/start-worker.sh << 'EOF'
#!/bin/bash
cd "/Users/storytellers/Documents/Claude Home/Lynkbot"
set -a; source .env; set +a
exec node -r ./run-ts.cjs apps/worker/src/index.ts
EOF
chmod +x /tmp/start-worker.sh

nohup /tmp/start-api.sh >> /tmp/lynkbot-api.log 2>&1 &
nohup /tmp/start-worker.sh >> /tmp/lynkbot-worker.log 2>&1 &
PORT=8080 API_URL=http://localhost:3000 nohup node server.mjs >> /tmp/lynkbot-dash.log 2>&1 &

echo "Waiting for API..."
until curl -s http://localhost:3000/health > /dev/null 2>&1; do sleep 1; done
echo "✓ API live at http://localhost:3000"
echo "✓ Dashboard live at http://localhost:8080"
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| API log is empty after start | Check `.env` exists and has `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `LYNK_INTERNAL_API_KEY` |
| `spawn ECANCELED` | Do not use esbuild CLI or tsx. Use `run-ts.cjs` only. |
| `tsc --emit` hangs | Do not use `tsc` to compile `apps/api` or `apps/worker`. Use `run-ts.cjs` at runtime. |
| Dashboard shows network error | Restart API with `CORS_ORIGIN="http://localhost:8080,http://127.0.0.1:8080"` |
| Port 3000 already in use | `pkill -f 'run-ts.cjs' && pkill -f 'apps/api/dist'` |
| Drizzle changes not picked up | Force recompile: `cd packages/db && node_modules/.bin/tsc` then restart API |
| DB column missing | Run raw `ALTER TABLE` via the `postgres` package (see Step 2) |

---

## Running Processes (check status)

```bash
ps aux | grep -E 'run-ts|server.mjs|worker' | grep -v grep
lsof -i :3000   # API
lsof -i :8080   # Dashboard
```
