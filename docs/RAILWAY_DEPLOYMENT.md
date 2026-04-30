# LynkBot Railway Deployment Guide

> **Scope:** Production deployment of the Flow Engine v2.1 monorepo (Phases 1–6) on Railway.
> All three services (`api`, `worker`, `dashboard`) deploy from the same repo on the same branch.

---

## 1. Service Architecture

| Railway Service | Source | Start Command |
|----------------|--------|---------------|
| `lynkbot-api` | `apps/api` | `pnpm -F api start` |
| `lynkbot-worker` | `apps/worker` | `pnpm -F worker start` |
| `lynkbot-dashboard` | `apps/dashboard` | `pnpm -F dashboard build && pnpm -F dashboard preview` |

**Linked infrastructure (Railway managed):**
- **PostgreSQL** — linked to both `api` and `worker` via `DATABASE_URL`
- **Redis** — linked to both `api` and `worker` via `REDIS_URL`

---

## 2. Environment Variables

### 2.1 Shared (set on both `api` and `worker`)

```bash
# ── Database & Cache ─────────────────────────────────────────────────────────
DATABASE_URL=postgresql://...       # auto-set by Railway PostgreSQL plugin
REDIS_URL=redis://...               # auto-set by Railway Redis plugin

# ── Auth ─────────────────────────────────────────────────────────────────────
JWT_SECRET=<min 32 chars, random>

# ── Internal API ─────────────────────────────────────────────────────────────
LYNK_INTERNAL_API_KEY=<min 10 chars, random>

# ── LLM (xAI Grok) ───────────────────────────────────────────────────────────
XAI_API_KEY=<from console.x.ai>
XAI_BASE_URL=https://api.x.ai/v1           # default
LLM_MODEL=grok-4-1-fast-reasoning          # default
LLM_PROVIDER=xai                           # default
LLM_FALLBACK_MODEL=grok-3                  # default

# ── WABA Pool Encryption ─────────────────────────────────────────────────────
# 32-byte AES-256-GCM key for encrypting per-tenant Meta access tokens in DB.
# Generate: openssl rand -hex 32
WABA_POOL_ENCRYPTION_KEY=<64 hex chars>

# ── Meta WhatsApp Cloud API (system-level fallback only) ─────────────────────
# Per-tenant credentials are stored encrypted in the `tenants` table.
# These are used only as a fallback for single-WABA legacy deployments.
META_ACCESS_TOKEN=<system user token>
META_PHONE_NUMBER_ID=<phone number id>
META_WABA_ID=<waba id>
META_APP_SECRET=<app secret for HMAC webhook verification>
META_WEBHOOK_VERIFY_TOKEN=lynkbot_webhook_verify   # or choose your own
META_API_VERSION=v23.0                             # default, pin this

# ── Payment ──────────────────────────────────────────────────────────────────
PAYMENT_PROVIDER=midtrans           # or xendit
MIDTRANS_SERVER_KEY=<server key>
MIDTRANS_CLIENT_KEY=<client key>
MIDTRANS_IS_PRODUCTION=false        # set true for production

# ── Shipping / Maps ───────────────────────────────────────────────────────────
RAJAONGKIR_API_KEY=<key>
RAJAONGKIR_BASE_URL=https://pro.rajaongkir.com/api   # default
GOOGLE_MAPS_API_KEY=<key>

# ── Object Storage (S3-compatible) ───────────────────────────────────────────
S3_BUCKET=<bucket name>
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_ENDPOINT=<optional, for non-AWS providers>

# ── Feature Flags (all default true) ─────────────────────────────────────────
# Set to 'false' to hard-disable a surface while business rules are finalised.
FEATURE_FLOW_BUILDER=true
FEATURE_TEMPLATE_STUDIO=true
FEATURE_FLOW_REENGAGEMENT=true
FEATURE_AI_FLOW_GENERATOR=true

# ── External OSINT (optional) ─────────────────────────────────────────────────
APIFY_API_KEY=<key>           # LinkedIn/Instagram scraping; skip gracefully if unset
SERPER_API_KEY=<key>          # Google Search for profile URL discovery; skip if unset

# ── Observability (optional) ─────────────────────────────────────────────────
SENTRY_DSN=<dsn>
LOG_LEVEL=info                # debug | info | warn | error
```

### 2.2 API-only

```bash
PORT=3000                     # Railway sets this automatically via $PORT
NODE_ENV=production
CORS_ORIGIN=https://your-dashboard.railway.app   # dashboard origin
WORKER_CONCURRENCY=5          # BullMQ concurrency per queue
```

### 2.3 Dashboard (`lynkbot-dashboard`)

```bash
# Vite build-time env vars — must be prefixed VITE_
VITE_API_BASE_URL=https://your-api.railway.app
```

---

## 3. Railway Service Setup

### 3.1 Linking Plugins

In the Railway project dashboard:

1. **PostgreSQL plugin** → connect to both `lynkbot-api` and `lynkbot-worker`  
   Railway injects `DATABASE_URL` automatically.

2. **Redis plugin** → connect to both `lynkbot-api` and `lynkbot-worker`  
   Railway injects `REDIS_URL` automatically.

### 3.2 Shared Variable Groups

Create a Railway variable group (or use Railway's reference syntax) for secrets shared by API and Worker:

```
JWT_SECRET              → shared
LYNK_INTERNAL_API_KEY   → shared
XAI_API_KEY             → shared
WABA_POOL_ENCRYPTION_KEY → shared
META_APP_SECRET         → shared
META_WEBHOOK_VERIFY_TOKEN → shared
```

### 3.3 Root Directory per Service

In each Railway service's **Settings → Source**:

| Service | Root Directory | Build Command | Start Command |
|---------|---------------|---------------|---------------|
| `lynkbot-api` | `/` (monorepo root) | `pnpm install && pnpm -F api build` | `pnpm -F api start` |
| `lynkbot-worker` | `/` | `pnpm install && pnpm -F worker build` | `pnpm -F worker start` |
| `lynkbot-dashboard` | `/` | `pnpm install && pnpm -F dashboard build` | `pnpm -F dashboard preview` |

> **Note:** The build command for `api` and `worker` must also build workspace dependencies in order:
> `pnpm -F @lynkbot/shared build && pnpm -F @lynkbot/db build && pnpm -F @lynkbot/meta build && pnpm -F @lynkbot/flow-engine build && pnpm -F @lynkbot/ai build && pnpm -F @lynkbot/pantheon build && pnpm -F @lynkbot/payments build && pnpm -F api build`

---

## 4. Database Migration Strategy

### 4.1 Migration Files (in order)

| File | Phase | What it does |
|------|-------|--------------|
| `0001_initial.sql` | pre-v2.1 | Base tables (buyers, conversations, tenants, etc.) |
| `0002_*.sql` … `0004_*.sql` | pre-v2.1 | Incremental schema additions |
| `0005_flow_engine.sql` | Phase 1–4 | Flow engine tables + tenant WABA pool columns |
| `0006_unique_tenant_risk_score.sql` | Phase 5 drift fix | Deduplicates and adds UNIQUE constraint on `tenant_risk_scores.tenant_id` |

### 4.2 First Deploy (fresh database)

```bash
# 1. Apply all migrations via Drizzle Kit
pnpm -F @lynkbot/db migrate

# 2. Seed initial cron jobs (one-time, via internal API)
curl -X POST https://your-api.railway.app/internal/flows/seed-cron \
  -H "x-api-key: $LYNK_INTERNAL_API_KEY"
```

### 4.3 Rolling Upgrade (existing database)

```bash
# Run from Railway's Deploy → Release Command, or a one-shot Railway job service:
pnpm -F @lynkbot/db migrate
```

Railway recommends using a **Release Command** (set under service Settings → Deploy):
```
pnpm -F @lynkbot/db migrate
```

This runs the migration before the new container starts, giving zero-downtime schema changes for additive migrations. For destructive operations (column drops, type changes), blue/green deploy is required.

### 4.4 Migration `0006` Safety Notes

`0006_unique_tenant_risk_score.sql` first deduplicates existing rows (keeping the most recent per tenant), then adds a `UNIQUE INDEX`. This is safe to run while the API is live because:

1. The deduplication `DELETE` uses `SELECT DISTINCT ON` — row-level, no table lock on modern Postgres
2. The `CREATE UNIQUE INDEX` in Postgres 12+ does not hold a full table lock (`CONCURRENT` is implicit for most DDL on partitioned tables; otherwise wrap in a low-traffic window)

---

## 5. Healthchecks

### 5.1 API (`lynkbot-api`)

Railway healthcheck path: `GET /health`  
Expected response: `200 OK` with body `{"status":"ok"}`

Configure in Railway service Settings → Health Check:
```
Path: /health
Timeout: 10s
Interval: 30s
```

### 5.2 Worker (`lynkbot-worker`)

Workers have no HTTP port. Use Railway's **process health** (restart policy) instead:

- **Restart policy:** On Failure, max 3 retries, 60s backoff
- Monitor via BullMQ dashboard (add `bull-board` or use Railway's log streaming)

### 5.3 Dashboard (`lynkbot-dashboard`)

Vite preview serves a static SPA. Railway auto-detects the port. Set:
```
Health Check Path: /
```

---

## 6. Meta Webhook Configuration

After deploying the API, configure the Meta webhook in **Meta Developer Console → WhatsApp → Configuration**:

```
Callback URL: https://your-api.railway.app/webhooks/meta
Verify Token: <META_WEBHOOK_VERIFY_TOKEN env var value>

Subscribe to:
  ✓ messages
  ✓ message_template_status_update
  ✓ phone_number_quality_update
```

The API exposes `GET /webhooks/meta` (verification) and `POST /webhooks/meta` (event ingestion).

---

## 7. First-Deploy Runbook

```bash
# 1. Set all required env vars in Railway dashboard for api + worker
# 2. Deploy (Railway auto-builds on push to main)
# 3. Verify migration ran:
railway run --service lynkbot-api pnpm -F @lynkbot/db migrate

# 4. Verify API is healthy:
curl https://your-api.railway.app/health
# → {"status":"ok"}

# 5. Seed cron jobs (once only):
curl -X POST https://your-api.railway.app/internal/flows/seed-cron \
  -H "x-api-key: $LYNK_INTERNAL_API_KEY"

# 6. Verify Meta webhook (Meta will send a GET challenge):
# → Check logs: "Meta webhook verified"

# 7. Create first tenant + register WABA credentials:
#    POST /v1/tenants  (JWT-authenticated, or seed via DB direct)

# 8. Confirm Worker is processing BullMQ jobs:
#    Check Railway logs for "lynkbot-flow-execution" queue activity
```

---

## 8. Rollback Procedure

### 8.1 Code rollback (no schema changes)

Use Railway's **Deployments** tab → redeploy a previous successful build.

### 8.2 Code rollback + schema changes

> Additive-only schema changes (new tables, new nullable columns, new indexes) can be rolled back by simply reverting the deploy — the old code ignores the new columns/tables.

For `0006_unique_tenant_risk_score.sql` specifically:
```sql
-- Rollback: drop the unique index (the deduplicated rows stay deleted)
DROP INDEX IF EXISTS tenant_risk_scores_tenant_unique;
```

For non-additive changes (column renames, type changes), a manual DB backup + restore is required before rollback. Always take a `pg_dump` snapshot before applying destructive migrations.

---

## 9. Security Checklist

- [ ] `JWT_SECRET` is at least 32 chars, cryptographically random
- [ ] `WABA_POOL_ENCRYPTION_KEY` is exactly 64 hex chars (openssl rand -hex 32)
- [ ] `LYNK_INTERNAL_API_KEY` is at least 10 chars, not guessable
- [ ] `META_APP_SECRET` is set — webhook HMAC verification is enforced in production
- [ ] `META_WEBHOOK_VERIFY_TOKEN` is non-default (change from `lynkbot_webhook_verify`)
- [ ] `NODE_ENV=production` is set on API and Worker
- [ ] `CORS_ORIGIN` is set to exact dashboard domain (not `*`)
- [ ] Midtrans `MIDTRANS_IS_PRODUCTION=true` (after testing is complete)
- [ ] Railway service is not publicly exposing the internal `**/internal/**` routes
  - These routes are guarded by `x-api-key` header; keep `LYNK_INTERNAL_API_KEY` secret
- [ ] S3 bucket policy: API service role has read/write; no public access
- [ ] Sentry DSN is set for error tracking in production

---

## 10. Monitoring

| Signal | Where to look |
|--------|--------------|
| API errors | Railway log stream → filter `ERROR` |
| Worker job failures | Railway log stream → filter `[BullMQ]` |
| LLM latency / errors | Railway logs → filter `llm` or Sentry |
| Risk score > 80 alerts | `tenant_risk_scores.score` — add Railway metric or Sentry alert |
| Meta delivery failures | Railway logs → `POST /webhooks/meta` 4xx responses |
| Migration status | `_drizzle_migrations` table in PostgreSQL |
| Queue backlogs | BullMQ Bull-Board (optional), or query Redis `LLEN lynkbot-*` |
