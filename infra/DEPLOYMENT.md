# LynkBot Deployment & Development Guide

This guide defines the unified, Docker-first workflow for both local development
and Railway production deployment.

---

## Critical Architecture Changes

| Removed | Why |
|---------|-----|
| `run-ts.cjs` | macOS-specific transpilation hook — fails on Railway's Alpine Linux |
| `scripts/build-api.sh` | Timestamp-based bash script that silently missed changed deps |
| `scripts/build-worker.sh` | Same issue — broke transitive type changes in `@lynkbot/shared` |
| `scripts/start-*.sh` | macOS workarounds that diverged from the production runtime |

**The root problem:** running macOS hacks locally while Railway ran standard Alpine Linux
created permanent dev/prod divergence. Any type change in `@lynkbot/shared` could silently
compile on macOS but crash on Railway.

**The fix:** all local development now runs inside Alpine Linux via Docker Compose.
Railway builds use `turbo prune` to isolate dependencies and eliminate pnpm symlink
cross-stage breakage.

---

## Architecture Overview

| Process | Local Dev | Production (Railway) |
|---------|-----------|----------------------|
| API | Alpine container (port 3000) | Dockerfile w/ turbo prune |
| Worker | Alpine container | Dockerfile w/ turbo prune |
| Dashboard | `pnpm --filter @lynkbot/dashboard dev` (port 8080) | Static nginx (Vite build) |
| DB | Local Postgres container | Railway Postgres |
| Cache | Local Redis container | Railway Redis |

---

## 1. Local Development

All services run inside Docker so they use identical Alpine Linux as Railway.
macOS-level `spawn ECANCELED` and esbuild restrictions don't affect Docker containers.

### First-time setup

```bash
# 1. Copy env template and fill in real values
cp .env.example .env

# 2. Make sure Docker Desktop (or OrbStack / Colima) is running

# 3. Boot the whole stack
docker-compose up --build
```

This spins up Postgres, Redis, the API (port 3000), and the Worker in one command.

### Dashboard (runs outside Docker for hot reload)

```bash
pnpm --filter @lynkbot/dashboard dev
# → http://localhost:8080
```

The dashboard talks to the API at `http://localhost:3000`.
Make sure `CORS_ORIGIN=http://localhost:8080` is set in your `.env`
(the docker-compose file injects this automatically).

### Iterating on code

After changing source files, rebuild only the affected containers:

```bash
docker-compose up --build api worker
```

Turborepo's cache skips unchanged packages automatically.

### Database migrations

Because the API runs in a standard Linux container, Drizzle works normally:

```bash
# Generate migration file after editing packages/db/src/schema/*.ts
pnpm --filter @lynkbot/db db:generate

# Apply to the running local Postgres container
pnpm --filter @lynkbot/db db:push
```

---

## 2. Production Deployment (Railway)

### ⚠️ One-time dashboard setup — REQUIRED before first deploy

Railway reads **one `railway.toml` per service**, configured via the service's "Config Path" setting.
Without this, Railway falls back to Nixpacks auto-detection and runs `pnpm --filter @pkg build`,
which **doesn't work** for this monorepo (builds deps in wrong order, breaks symlinks).

**Do this once in the Railway dashboard for each service:**

| Service | Setting | Value |
|---------|---------|-------|
| `lynkbot-api` | Settings → Source → **Config Path** | `infra/api.railway.toml` |
| `lynkbot-worker` | Settings → Source → **Config Path** | `infra/worker.railway.toml` |
| `lynkbot-dashboard` | Settings → Source → **Config Path** | `infra/dashboard.railway.toml` |
| All services | Settings → Source → **Root Directory** | *(leave empty)* |

After setting Config Path, trigger a manual redeploy. Subsequent `git push` to `main`
will deploy automatically.

---

### How turbo prune stops Railway from hanging

**Before (broken):** sequential `pnpm --filter @lynkbot/shared run build` commands
re-evaluated the entire monorepo graph for every package, caused massive CPU/RAM
spikes, and broke pnpm workspace symlinks when copied between Docker stages.

**Now:** three isolated stages per service:

1. **Pruner** — `turbo prune @lynkbot/api --docker` extracts *only* the packages
   that `apps/api` actually needs into a minimal `out/` directory with a pruned
   `pnpm-lock.yaml`.
2. **Builder** — installs pruned deps (`pnpm install`) and compiles the whole graph
   in one stage (`turbo run build --filter=@lynkbot/api...`). Symlinks stay coherent
   because install and build happen in the SAME filesystem layer.
3. **Runner** — copies only compiled `dist/` files and `node_modules` into a minimal
   Alpine image.

### Required Railway environment variables

Set these in Railway → service → Variables for each service.

#### API service

| Variable | Example / Notes |
|----------|-----------------|
| `DATABASE_URL` | `postgresql://...` (Railway provides via Postgres plugin) |
| `REDIS_URL` | `redis://...` (Railway provides via Redis plugin) |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `XAI_API_KEY` | From xAI console |
| `XAI_BASE_URL` | `https://api.x.ai/v1` |
| `XAI_MODEL` | `grok-4-1-fast-reasoning` |
| `XAI_EMBEDDING_MODEL` | `text-embedding-3-small` |
| `META_ACCESS_TOKEN` | System user token from Meta Business Suite |
| `META_PHONE_NUMBER_ID` | Meta → WhatsApp → Phone numbers |
| `META_VERIFY_TOKEN` | Any random string; used to verify webhook subscription |
| `MIDTRANS_SERVER_KEY` | Midtrans dashboard |
| `MIDTRANS_CLIENT_KEY` | Midtrans dashboard |
| `XENDIT_SECRET_KEY` | Xendit dashboard |
| `CORS_ORIGIN` | Your Railway dashboard domain (e.g. `https://lynkbot-dashboard.up.railway.app`) |
| `NODE_ENV` | `production` |

#### Worker service

Same as API minus `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`, `CORS_ORIGIN`.

#### Dashboard service (**Build Variable**, not runtime)

| Variable | Notes |
|----------|-------|
| `VITE_API_URL` | **Must be set as a Build Variable in Railway.** Vite bakes this into the JS bundle at build time. Example: `https://lynkbot-api.up.railway.app` |

> In Railway: dashboard service → Settings → Build variables → add `VITE_API_URL`.
> Regular env vars (runtime) do NOT work for Vite.

### After first deploy

1. In Meta Developer Console, update the webhook URL to:
   `https://<your-api-domain>.up.railway.app/webhooks/meta`
2. Run database migrations via Railway CLI or the API's startup hook.

---

## 3. Troubleshooting

| Symptom | Fix |
|---------|-----|
| API container exits immediately | Check `.env`. Ensure `DATABASE_URL` uses `postgres` (Docker hostname) not `localhost`: `postgresql://lynkbot:localpassword@postgres:5432/lynkbot?sslmode=disable` |
| Changes in `@lynkbot/shared` not showing | Rebuild containers: `docker-compose up --build api worker` |
| Railway build fails on `pnpm install` | Ensure `pnpm-lock.yaml` is committed. The pruner strictly requires it to reconstruct the isolated workspace. |
| Dashboard shows CORS errors locally | Add `CORS_ORIGIN=http://localhost:8080` to `.env` |
| `TS2307: Cannot find module '@lynkbot/*'` | This was caused by cross-stage pnpm symlink breakage — fixed by turbo prune. If it reappears, ensure `pnpm-lock.yaml` is up-to-date (`pnpm install` locally then commit). |
| Railway dashboard build ignores `VITE_API_URL` | Must be a **Build Variable** (Railway Settings tab), not a regular runtime env var. |

---

## 4. Dockerfile Structure Reference

Both `apps/api/Dockerfile` and `apps/worker/Dockerfile` follow this pattern:

```dockerfile
FROM node:20-alpine AS alpine
RUN npm install -g turbo@2 && corepack enable && corepack prepare pnpm@9 --activate

# Stage 1: Pruner
FROM alpine AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @lynkbot/api --docker   # or @lynkbot/worker

# Stage 2: Builder
FROM alpine AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN turbo run build --filter=@lynkbot/api...   # or @lynkbot/worker...

# Stage 3: Runner
FROM node:20-alpine AS runner
# ... copy dist/ + node_modules + package.json files
CMD ["node", "dist/index.js"]
```
