# LynkBot Deployment & Development Guide

---

## Railway Setup Checklist (New Project)

Follow these steps exactly. The whole setup should take about 10 minutes.

### Step 1 — Create project and add plugins

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → `dna160/lynkbot`
2. Railway creates one service automatically (this becomes the API).
3. In the project, click **+ New** → **Database** → **Add PostgreSQL**
4. Click **+ New** → **Database** → **Add Redis**

---

### Step 2 — Configure the API service

Railway's auto-created service will use the root `Dockerfile` with `SERVICE=api` by default.
No build configuration changes needed.

**Variables to set** (Settings → Variables):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | run: `openssl rand -hex 32` |
| `XAI_API_KEY` | from xAI console |
| `XAI_BASE_URL` | `https://api.x.ai/v1` |
| `XAI_MODEL` | `grok-4-1-fast-reasoning` |
| `XAI_EMBEDDING_MODEL` | `text-embedding-3-small` |
| `META_ACCESS_TOKEN` | WhatsApp System User token |
| `META_PHONE_NUMBER_ID` | from Meta → WhatsApp → Phone Numbers |
| `META_WABA_ID` | from Meta → WhatsApp → Overview |
| `META_APP_SECRET` | from Meta → App → Settings → Basic |
| `META_WEBHOOK_VERIFY_TOKEN` | any random string (e.g. `lynkbot_webhook_verify`) |
| `META_API_VERSION` | `v23.0` |
| `RAJAONGKIR_API_KEY` | from Raja Ongkir Pro dashboard |
| `MIDTRANS_SERVER_KEY` | from Midtrans dashboard |
| `MIDTRANS_CLIENT_KEY` | from Midtrans dashboard |
| `XENDIT_SECRET_KEY` | from Xendit dashboard |
| `CORS_ORIGIN` | your dashboard Railway domain (fill in after dashboard deploys) |
| `DATABASE_URL` | auto-injected by Railway Postgres plugin |
| `REDIS_URL` | auto-injected by Railway Redis plugin |

**Optional — add health check** (Settings → Deploy → Health Check Path): `/health`

**Add public domain** (Settings → Networking → Add Domain) — note this URL, you'll need it for `VITE_API_URL`.

---

### Step 3 — Add the Worker service

1. Click **+ New** → **GitHub Repo** → same repo (`dna160/lynkbot`)
2. Go to this service → **Variables** → Add:

| Variable | Value | Toggle |
|---|---|---|
| `SERVICE` | `worker` | ✅ **Build Variable** (toggle ON) |
| `DATABASE_URL` | reference from Postgres plugin | — |
| `REDIS_URL` | reference from Redis plugin | — |
| `XAI_API_KEY` | same as API | — |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | — |
| `XAI_MODEL` | `grok-4-1-fast-reasoning` | — |
| `META_ACCESS_TOKEN` | same as API | — |
| `RAJAONGKIR_API_KEY` | same as API | — |
| `NODE_ENV` | `production` | — |

> **Critical:** `SERVICE=worker` must have the **Build Variable** toggle ON. This passes it as a Docker build arg, not a runtime env var.

---

### Step 4 — Add the Dashboard service

1. Click **+ New** → **GitHub Repo** → same repo
2. Go to this service → **Settings → Source → Config Path**: `infra/dashboard.railway.toml`
3. **Variables** → Add Build Variables:

| Variable | Value | Toggle |
|---|---|---|
| `VITE_API_URL` | `https://your-api-domain.up.railway.app` | ✅ **Build Variable** |

> Dashboard has no runtime env vars — it's a static nginx bundle.

**Add public domain** (Settings → Networking → Add Domain).

---

### Step 5 — Deploy all services

Click **Deploy** on each service, or push to `main` — Railway builds all three automatically.

**After first deploy:**
1. Copy the API's public domain URL
2. Update `CORS_ORIGIN` in the API service variables
3. In Meta Developer Console → WhatsApp → Configuration → Webhook URL:
   `https://your-api-domain.up.railway.app/webhooks/meta`

---

## Why this works (architecture notes)

### The build system

All three services use `turbo prune` Docker builds. Railway was previously falling back to
Nixpacks auto-detection (which ran `pnpm --filter @pkg build` and failed) because:
- The `railway.toml` was inside `infra/` — Railway only reads it from the **repo root**
- The old `[[services]]` array syntax is not valid Railway TOML
- No `railway.toml` at root = Railway uses Nixpacks by default

**Now:**
- `railway.toml` at repo root → Railway reads it for all services → `builder = "DOCKERFILE"`
- Root `Dockerfile` handles both API and Worker via `ARG SERVICE=api` (default = api)
- Worker gets `SERVICE=worker` via build variable → same Dockerfile, different output
- Dashboard uses `apps/dashboard/Dockerfile` via Config Path (nginx-based, can't share with node services)

### Why turbo prune (not sequential pnpm --filter)

`turbo prune @lynkbot/api --docker` extracts a minimal workspace for only what `apps/api`
needs. Then `turbo run build --filter=@lynkbot/api...` compiles in topological order (shared
→ db → ai → ... → api) automatically. Both happen in the SAME Docker stage so pnpm
workspace symlinks are never broken by cross-stage copying.

---

## Local Development

```bash
# 1. Copy env and fill in values
cp .env.example .env

# 2. Start the full stack (Postgres + Redis + API + Worker)
docker-compose up --build

# 3. Dashboard (hot reload, separate terminal)
pnpm --filter @lynkbot/dashboard dev
# → http://localhost:8080
```

After source changes:
```bash
docker-compose up --build api worker
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Railway uses Nixpacks / runs `pnpm --filter` | Check `railway.toml` exists at repo root. Verify Config Path is set for dashboard service. |
| Worker deploys as API (no job processing) | `SERVICE=worker` must be a **Build Variable** (toggle), not a regular env var. |
| `TS2307: Cannot find module '@lynkbot/*'` | Commit latest `pnpm-lock.yaml`. Also ensure `tsconfig.base.json` is at repo root. |
| Dashboard CORS errors locally | Set `CORS_ORIGIN=http://localhost:8080` in `.env` |
| API health check failing | Ensure all required env vars are set (especially `DATABASE_URL`, `REDIS_URL`) |
| `VITE_API_URL` undefined in dashboard | Must be a **Build Variable** — Vite bakes it at build time, not runtime |
