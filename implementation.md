# LynkBot Implementation Master Reference

> **Purpose:** Single authoritative reference for any agent picking up this codebase. Covers architecture,
> feature locations, API surface, DB schema, type system, design patterns, and operational details.
> Synthesized from PRD v2.1, all 6 phase handoffs, checkpoint audit, and verified source files.
>
> **Branch:** `claude/elegant-brattain-b5512a`
> **Last completed phase:** Phase 6 — 64/64 tests passing, zero TypeScript errors
> **Working directory:** `/Users/storytellers/Documents/Claude Home/Lynkbot/.claude/worktrees/elegant-brattain-b5512a`

---

## Table of Contents

1. [What LynkBot Is](#1-what-lynkbot-is)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Package Dependency Graph](#3-package-dependency-graph)
4. [Feature Index — Where to Find Everything](#4-feature-index)
5. [API Surface — All Routes](#5-api-surface)
6. [Database Schema](#6-database-schema)
7. [Worker Queues & Processors](#7-worker-queues--processors)
8. [Flow Engine — Type System](#8-flow-engine--type-system)
9. [Flow Engine — Node Processors](#9-flow-engine--node-processors)
10. [Compliance Rules (Hard Guards)](#10-compliance-rules-hard-guards)
11. [Design Patterns & Idioms](#11-design-patterns--idioms)
12. [Dashboard UI — Pages & Components](#12-dashboard-ui--pages--components)
13. [Authentication & Middleware](#13-authentication--middleware)
14. [Environment Variables](#14-environment-variables)
15. [Testing — Files & Patterns](#15-testing--files--patterns)
16. [Build Order & Commands](#16-build-order--commands)
17. [Deployment — Railway Runbook](#17-deployment--railway-runbook)
18. [PRD vs Implementation — Divergences](#18-prd-vs-implementation--divergences)
19. [Known Debt & Stubs](#19-known-debt--stubs)

---

## 1. What LynkBot Is

LynkBot is a **WhatsApp Commerce Platform for Indonesian SMB merchants**. Merchants connect their WhatsApp Business API (Meta WABA) account and get:

- **Conversational AI sales assistant** — handles inbound buyer messages, manages conversations through a state machine (GREETING → BROWSING → CHECKOUT → etc.)
- **Flow Engine** — automated customer journey flows triggered by button clicks, broadcasts, time-based cron, or inbound keywords
- **Template Studio** — create, submit, and track Meta-approved WhatsApp message templates
- **Re-engagement campaigns** — broadcast to buyer segments with risk-gated compliance
- **AI Flow Generator** — describe a campaign in natural language, Grok (xAI) generates a `FlowDefinition` JSON
- **Risk Scoring** — 5-factor score blocks dangerous sending behaviour

**Target market:** Indonesian SMBs. All AI prompts are bilingual (English structure, Indonesian customer-facing content). Jakarta timezone (UTC+7) used for send-window gates.

**WhatsApp API:** Meta Graph API v23.0. Per-tenant WABA credentials stored AES-256-GCM encrypted. Shared WABA pool (5 accounts) for onboarding; manual BYOW path for advanced users.

---

## 2. Monorepo Structure

```
.
├── LynkBot_Flow_Engine_PRD_v2.1.md   # North star — read this first
├── apps/
│   ├── api/                          # Fastify HTTP server (Node.js)
│   │   └── src/
│   │       ├── config.ts             # All env var parsing + validation (Zod)
│   │       ├── index.ts              # Server bootstrap — registers all routes
│   │       ├── migrate.ts            # Drizzle migration runner (runs on startup)
│   │       ├── middleware/           # featureGate, internalApiKey, signatures
│   │       ├── plugins/              # auth (JWT), cors, rateLimit
│   │       ├── routes/
│   │       │   ├── internal/         # cron.ts, wabaPool.ts (x-api-key protected)
│   │       │   ├── v1/               # All public REST routes
│   │       │   └── webhooks/         # meta.ts, midtrans.ts, xendit.ts, wati.ts
│   │       ├── services/             # Business logic layer
│   │       └── utils/                # crypto.ts (AES-256-GCM)
│   ├── dashboard/                    # Vite + React SPA (dark theme, Tailwind)
│   │   └── src/
│   │       ├── App.tsx               # Route definitions
│   │       ├── components/           # Shared UI: Sidebar, RiskScoreGauge
│   │       ├── declarations.d.ts     # Drawflow type shim
│   │       ├── hooks/                # useAuth, useConversations, etc.
│   │       ├── lib/
│   │       │   ├── api.ts            # All API client methods (axios)
│   │       │   └── queryClient.ts    # React Query config
│   │       └── pages/                # Feature pages (see §12)
│   └── worker/                       # BullMQ background job runner (no HTTP)
│       └── src/
│           ├── index.ts              # Worker bootstrap — registers all processors
│           ├── processors/           # One file per queue
│           └── queues.ts             # Queue constants reference
├── packages/
│   ├── ai/                           # @lynkbot/ai — LLM clients (Grok/xAI), RAG pipeline
│   ├── db/                           # @lynkbot/db — Drizzle ORM, schema, migrations
│   ├── flow-engine/                  # @lynkbot/flow-engine — core runtime (see §8-9)
│   ├── meta/                         # @lynkbot/meta — MetaClient (WhatsApp Graph API)
│   ├── pantheon/                     # @lynkbot/pantheon — buyer genome / analytics
│   ├── payments/                     # @lynkbot/payments — Midtrans + Xendit
│   ├── shared/                       # @lynkbot/shared — constants (QUEUES, etc.)
│   └── wati/                         # @lynkbot/wati — legacy WATI adapter
├── infra/
│   └── scripts/
│       ├── seed-waba-pool.ts         # Seed WABA pool accounts (fill TODOs before running)
│       ├── seed.ts                   # General DB seed
│       └── migrate.ts                # Standalone migration runner
├── Dockerfile                        # Production image
├── Dockerfile.test                   # CI test image (runs vitest)
├── docker-compose.yml                # Local dev (postgres + redis)
├── pnpm-workspace.yaml               # Workspace package list
├── turbo.json                        # Turbo build pipeline
└── docs/
    ├── RAILWAY_DEPLOYMENT.md         # Full Railway deploy guide (env vars, runbook)
    └── flow-engine-build/
        ├── PHASE_PLAN.md             # Orchestration overview + compliance invariants
        ├── PHASE_1_HANDOFF.md        # Foundation (DB, crypto, WABA pool, MetaClient)
        ├── PHASE_2_HANDOFF.md        # Flow Engine package + CRUD routes
        ├── PHASE_3_HANDOFF.md        # Template Studio
        ├── PHASE_4_HANDOFF.md        # Risk scoring + re-engagement
        ├── PHASE_5_HANDOFF.md        # AI flow generation + dashboard UI
        ├── PHASE_6_HANDOFF.md        # Test suite completion + deployment guide
        └── PHASES_1_5_CHECKPOINT.md  # Single-page audit record
```

---

## 3. Package Dependency Graph

Build in this exact order (each depends on those before it):

```
@lynkbot/shared
    └── @lynkbot/db
            └── @lynkbot/meta
                    └── @lynkbot/flow-engine
                            ├── @lynkbot/ai
                            │       └── @lynkbot/pantheon
                            ├── @lynkbot/payments
                            └── @lynkbot/wati
                                    ├── apps/api       (depends on all above)
                                    ├── apps/worker    (depends on db, shared, flow-engine, ai, payments)
                                    └── apps/dashboard (standalone Vite SPA, no workspace deps)
```

**Build command (full workspace):**
```bash
pnpm -F @lynkbot/shared build
pnpm -F @lynkbot/db build
pnpm -F @lynkbot/meta build
pnpm -F @lynkbot/flow-engine build
pnpm -F @lynkbot/ai build || true        # optional; skip if not needed
pnpm -F @lynkbot/pantheon build || true  # optional
pnpm -F @lynkbot/payments build || true  # optional
pnpm -F @lynkbot/wati build || true      # optional
pnpm -F api build
pnpm -F worker build
pnpm -F dashboard build
```

---

## 4. Feature Index

Every feature cross-referenced to its file(s).

### 4.1 Per-Tenant WhatsApp (MetaClient)

| Component | File |
|-----------|------|
| MetaClient class | `packages/meta/src/MetaClient.ts` |
| `MetaClient.fromTenant(tenant)` static | `packages/meta/src/MetaClient.ts` |
| `getTenantMetaClient(tenantId)` helper | `apps/api/src/services/_meta.helper.ts` |
| AES-256-GCM encrypt/decrypt | `apps/api/src/utils/crypto.ts` |

**Pattern:** All services use `getTenantMetaClient(tenantId)` (never `config.META_ACCESS_TOKEN`). The helper decrypts the token from DB and returns a ready `MetaClient`.

### 4.2 WABA Pool

| Component | File |
|-----------|------|
| WABA pool service | `apps/api/src/services/wabaPool.service.ts` |
| WABA pool DB schema | `packages/db/src/schema/wabaPool.ts` |
| Internal admin routes | `apps/api/src/routes/internal/wabaPool.ts` |
| Seed script | `infra/scripts/seed-waba-pool.ts` |

**Routes:** `GET /internal/waba-pool`, `POST /internal/waba-pool` (x-api-key protected)

### 4.3 Onboarding

| Component | File |
|-----------|------|
| Onboarding service | `apps/api/src/services/onboarding.service.ts` |
| Onboarding routes | `apps/api/src/routes/v1/onboarding.ts` |
| Dashboard page | `apps/dashboard/src/pages/OnboardingPage.tsx` |

**Two paths:** Pool (auto-assign WABA number) or Manual (enter own credentials). On pool exhaustion, creates ops ticket with `type='waba_assignment_required'`.

### 4.4 Flow Builder (Feature 1)

| Component | File |
|-----------|------|
| FlowEngine class | `packages/flow-engine/src/engine.ts` |
| All types | `packages/flow-engine/src/types.ts` |
| Flow CRUD routes | `apps/api/src/routes/v1/flows.ts` |
| Flow list dashboard | `apps/dashboard/src/pages/Flows/FlowsListPage.tsx` |
| Flow editor (Drawflow canvas) | `apps/dashboard/src/pages/Flows/FlowEditorPage.tsx` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` → `flowsApi` |

**Routes:** `GET|POST /api/v1/flows`, `GET|PUT|PATCH|DELETE /api/v1/flows/:id`, `GET /api/v1/flows/:id/executions`, `GET /api/v1/flows/:id/risk-score`, `POST /api/v1/flows/:id/test`

**Activation gate:** `PATCH /api/v1/flows/:id/status` blocks if risk score > 80.

### 4.5 Template Studio (Feature 2)

| Component | File |
|-----------|------|
| TemplateStudioService | `apps/api/src/services/templateStudio.service.ts` |
| Flow template routes | `apps/api/src/routes/v1/flowTemplates.ts` |
| Template list dashboard | `apps/dashboard/src/pages/Templates/TemplateListPage.tsx` |
| Template editor dashboard | `apps/dashboard/src/pages/Templates/TemplateEditorPage.tsx` |
| WhatsApp preview component | `apps/dashboard/src/pages/Templates/components/TemplatePreview.tsx` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` → `flowTemplatesApi` |
| Worker sync processor | `apps/worker/src/processors/templateSync.processor.ts` |
| DB schema | `packages/db/src/schema/flowTemplates.ts` |

**Routes:** `GET|POST /api/v1/flow-templates`, `GET|PUT /api/v1/flow-templates/:id`, `POST /api/v1/flow-templates/:id/submit`, `POST /api/v1/flow-templates/:id/appeal` (max 2), `POST /api/v1/flow-templates/:id/pause`, `DELETE /api/v1/flow-templates/:id` (409 if in-use by active flow)

**Status machine:** `draft` → `pending_review` → `approved|rejected|flagged|in_appeal|disabled` → `reinstated`

### 4.6 Re-engagement & Broadcasts (Feature 3)

| Component | File |
|-----------|------|
| Broadcast routes | `apps/api/src/routes/v1/broadcasts.ts` |
| `broadcastToSegment` | `packages/flow-engine/src/engine.ts` |
| `evaluateTimeTriggers` | `packages/flow-engine/src/engine.ts` |
| Cooldown checker | `packages/flow-engine/src/cooldownChecker.ts` |
| Broadcast log schema | `packages/db/src/schema/buyerBroadcastLog.ts` |

**Cooldown rules (enforced by CooldownChecker):**
- Same marketing template to same buyer: max 1× per 7 days
- Any marketing template to same buyer: max 1× per 24h
- `doNotContact=true`: always blocked

### 4.7 Risk Scoring (Feature 4)

| Component | File |
|-----------|------|
| RiskScoreService | `apps/api/src/services/riskScore.service.ts` |
| Risk score formula | `packages/flow-engine/src/riskScoreCalculator.ts` |
| Risk score routes | `apps/api/src/routes/v1/riskScore.ts` |
| Risk score gauge (dashboard) | `apps/dashboard/src/components/RiskScoreGauge.tsx` |
| Worker processor | `apps/worker/src/processors/riskScore.processor.ts` |
| DB schema | `packages/db/src/schema/tenantRiskScores.ts` |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` → `riskScoreApi` |

**Formula (5 factors, score 1–100):**
```
score = (broadcastFrequency × 0.35) + (templateQuality × 0.25) +
        (blockProxy × 0.20) + (optInConfidence × 0.15) + (sendSpeed × 0.05)
```
- Score > 80 → activation blocked (non-overridable)
- Score > 60 → warning in response
- 1h TTL cache in DB (`lastRiskScoreAt` column on `tenantRiskScores`)

**Gauge colors:** green (1–30) / yellow (31–60) / orange (61–80) / red (81–100)

### 4.8 AI Flow Generation (Feature 5)

| Component | File |
|-----------|------|
| AI routes | `apps/api/src/routes/v1/ai.ts` |
| System prompt + helpers | `packages/flow-engine/src/prompts/flowGeneration.ts` |
| `buildFlowGenPrompt` | `packages/flow-engine/src/prompts/flowGeneration.ts` |
| `buildFlowModPrompt` | `packages/flow-engine/src/prompts/flowGeneration.ts` |
| LLM client factory | `packages/ai/src/llm/factory.ts` |
| Grok client | `packages/ai/src/llm/GrokClient.ts` |
| Dashboard AI panel | `apps/dashboard/src/pages/Flows/FlowEditorPage.tsx` (inline) |
| Dashboard API client | `apps/dashboard/src/lib/api.ts` → `aiApi` |

**Routes:** `POST /api/v1/ai/generate-flow`, `POST /api/v1/ai/modify-flow`

Both routes are behind `requireFeature('ai_flow_generator')` preHandler.

**AI response handling:** JSON parsed leniently — markdown fences stripped, parse errors surfaced as `parseError` field but response still returned. AI-generated flows are ALWAYS `status: 'draft'`; never auto-activated.

### 4.9 Conversational AI (pre-existing)

| Component | File |
|-----------|------|
| Conversation service | `apps/api/src/services/conversation.service.ts` |
| Conversation routes | `apps/api/src/routes/v1/conversations.ts` |
| Meta webhook handler | `apps/api/src/routes/webhooks/meta.ts` |
| AI prompts | `packages/ai/src/prompts/` |
| RAG pipeline | `packages/ai/src/rag/` |

**Conversation state machine:** `GREETING → BROWSING → CART → CHECKOUT → AWAITING_PAYMENT → ORDER_CONFIRMED → CLOSED_WON / CLOSED_LOST / ESCALATED`

**STOP/BERHENTI handler:** Sets `doNotContact=true` on buyer + cancels all active flow executions.

---

## 5. API Surface

All routes are prefixed `/api` when registered. Full paths shown below.

### Health

| Method | Path | Auth | File |
|--------|------|------|------|
| GET | `/health` | none | `apps/api/src/index.ts` |

### Webhooks (no JWT — HMAC verified)

| Method | Path | File |
|--------|------|------|
| GET | `/webhooks/meta` | `apps/api/src/routes/webhooks/meta.ts` (verify token) |
| POST | `/webhooks/meta` | `apps/api/src/routes/webhooks/meta.ts` (ingest events) |
| POST | `/webhooks/midtrans` | `apps/api/src/routes/webhooks/midtrans.ts` |
| POST | `/webhooks/xendit` | `apps/api/src/routes/webhooks/xendit.ts` |
| POST | `/webhooks/wati` | `apps/api/src/routes/webhooks/wati.ts` |

### Auth

| Method | Path | Auth | File |
|--------|------|------|------|
| POST | `/api/v1/auth/login` | none | `apps/api/src/routes/v1/auth.ts` |
| POST | `/api/v1/auth/refresh` | none | `apps/api/src/routes/v1/auth.ts` |

### Tenants

| Method | Path | Auth | File |
|--------|------|------|------|
| GET | `/api/v1/tenants/me` | JWT | `apps/api/src/routes/v1/tenants.ts` |
| PATCH | `/api/v1/tenants/me` | JWT | `apps/api/src/routes/v1/tenants.ts` |

### Onboarding

| Method | Path | Auth | File |
|--------|------|------|------|
| POST | `/api/v1/onboarding/complete` | JWT | `apps/api/src/routes/v1/onboarding.ts` |
| GET | `/api/v1/onboarding/status` | JWT | `apps/api/src/routes/v1/onboarding.ts` |

### Products / Inventory / Orders

| Method | Path | File |
|--------|------|------|
| CRUD | `/api/v1/products` | `apps/api/src/routes/v1/products.ts` |
| CRUD | `/api/v1/inventory` | `apps/api/src/routes/v1/inventory.ts` |
| CRUD | `/api/v1/orders` | `apps/api/src/routes/v1/orders.ts` |

### Buyers & Conversations

| Method | Path | File |
|--------|------|------|
| CRUD + import | `/api/v1/buyers` | `apps/api/src/routes/v1/buyers.ts` |
| CRUD | `/api/v1/conversations` | `apps/api/src/routes/v1/conversations.ts` |
| CRUD | `/api/v1/broadcasts` | `apps/api/src/routes/v1/broadcasts.ts` |

### Flow Engine Routes

| Method | Path | Feature Gate | File |
|--------|------|-------------|------|
| GET | `/api/v1/flows` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| POST | `/api/v1/flows` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| GET | `/api/v1/flows/:id` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| PUT | `/api/v1/flows/:id` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| PATCH | `/api/v1/flows/:id/status` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| DELETE | `/api/v1/flows/:id` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| GET | `/api/v1/flows/:id/executions` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| GET | `/api/v1/flows/:id/risk-score` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |
| POST | `/api/v1/flows/:id/test` | `flow_builder` | `apps/api/src/routes/v1/flows.ts` |

### Template Studio Routes

| Method | Path | Feature Gate | File |
|--------|------|-------------|------|
| GET | `/api/v1/flow-templates` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| POST | `/api/v1/flow-templates` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| GET | `/api/v1/flow-templates/:id` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| PUT | `/api/v1/flow-templates/:id` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| POST | `/api/v1/flow-templates/:id/submit` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| POST | `/api/v1/flow-templates/:id/appeal` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| POST | `/api/v1/flow-templates/:id/pause` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |
| DELETE | `/api/v1/flow-templates/:id` | `template_studio` | `apps/api/src/routes/v1/flowTemplates.ts` |

### Risk Score Routes

| Method | Path | Auth | File |
|--------|------|------|------|
| GET | `/api/v1/risk-score` | JWT | `apps/api/src/routes/v1/riskScore.ts` |
| POST | `/api/v1/risk-score/compute` | JWT | `apps/api/src/routes/v1/riskScore.ts` |

### AI Routes

| Method | Path | Feature Gate | File |
|--------|------|-------------|------|
| POST | `/api/v1/ai/chat` | JWT | `apps/api/src/routes/v1/ai.ts` (pre-existing) |
| POST | `/api/v1/ai/generate-flow` | `ai_flow_generator` | `apps/api/src/routes/v1/ai.ts` |
| POST | `/api/v1/ai/modify-flow` | `ai_flow_generator` | `apps/api/src/routes/v1/ai.ts` |

### Analytics & Intelligence

| Method | Path | File |
|--------|------|------|
| GET | `/api/v1/analytics/*` | `apps/api/src/routes/v1/analytics.ts` |
| GET | `/api/v1/intelligence/*` | `apps/api/src/routes/v1/intelligence.ts` |

### Internal Routes (x-api-key protected)

| Method | Path | File |
|--------|------|------|
| GET | `/internal/waba-pool` | `apps/api/src/routes/internal/wabaPool.ts` |
| POST | `/internal/waba-pool` | `apps/api/src/routes/internal/wabaPool.ts` |
| POST | `/internal/flows/seed-cron` | `apps/api/src/routes/internal/cron.ts` |

---

## 6. Database Schema

**ORM:** Drizzle ORM. Schema files in `packages/db/src/schema/`. All exported from `packages/db/src/schema/index.ts`.

**Migrations:** `packages/db/src/migrations/` — run via `pnpm -F @lynkbot/db migrate`. Runs automatically on API startup (`apps/api/src/migrate.ts`).

### Pre-existing Tables (before Flow Engine)

| Table | Schema File | Key Columns |
|-------|-------------|-------------|
| `tenants` | `tenants.ts` | `id, lynkUserId, storeName, wabaId, watiApiKeyEnc, subscriptionTier (trial\|growth\|pro\|scale), metaAccessToken (encrypted), messagingTier (int), wabaQualityRating, lastRiskScoreAt` |
| `buyers` | `buyers.ts` | `id, tenantId, waPhone, displayName, preferredLanguage, totalOrders, totalSpendIdr, lastOrderAt, tags (JSONB), doNotContact, activeFlowCount` |
| `conversations` | `conversations.ts` | `id, tenantId, buyerId, state (state machine), messageCount, lastMessageAt` |
| `messages` | `messages.ts` | `id, conversationId, direction (inbound\|outbound), body, createdAt` |
| `products` | `products.ts` | Standard product catalog |
| `inventory` | `inventory.ts` | Stock levels |
| `orders` | `orders.ts` | Order lifecycle |
| `shipments` | `shipments.ts` | Shipping tracking |
| `broadcasts` | `broadcasts.ts` | `id, tenantId, templateName, audienceFilter (JSONB), status, flowId (FK), riskScoreAtSend` |
| `buyer_genomes` | `buyerGenomes.ts` | Pantheon enrichment data |
| `ops_tickets` | `opsTickets.ts` | Internal ops tasks |
| `audit_logs` | `auditLogs.ts` | Immutable audit trail |

### Flow Engine Tables (Migration 0005)

| Table | Schema File | Key Columns |
|-------|-------------|-------------|
| `flow_definitions` | `flowDefinitions.ts` | `id, tenantId, name, description, status (draft\|active\|paused\|archived), nodes (JSONB = FlowDefinition), triggerType, createdAt, updatedAt` |
| `flow_executions` | `flowExecutions.ts` | `id, tenantId, flowId, buyerId, conversationId, status (running\|waiting_reply\|completed\|cancelled\|failed), currentNodeId, executionLog (JSONB), startedAt, completedAt` |
| `flow_templates` | `flowTemplates.ts` | `id, tenantId, name (snake_case), displayName, category (MARKETING\|UTILITY\|AUTHENTICATION), language, components (JSONB), status (draft\|pending_review\|approved\|rejected\|disabled\|flagged\|in_appeal), metaTemplateId, appealCount, submittedAt, approvedAt` |
| `buyer_broadcast_log` | `buyerBroadcastLog.ts` | `id, tenantId, buyerId, templateName, sentAt` — used by CooldownChecker |
| `tenant_risk_scores` | `tenantRiskScores.ts` | `id, tenantId (UNIQUE), score, breakdown (JSONB), computedAt` |
| `waba_pool` | `wabaPool.ts` | `id, phoneNumberId, displayPhone, wabaId, accessTokenEnc (AES-256-GCM encrypted), status (available\|assigned), assignedTo (tenantId FK), assignedAt` |

### Migration File Index

| File | Phase | What it does |
|------|-------|--------------|
| `0001_initial.sql` … `0004_*.sql` | pre-v2.1 | Base schema |
| `0005_flow_engine.sql` | Phase 1–4 | All 6 new tables + ALTERs to tenants/buyers/broadcasts |
| `0006_unique_tenant_risk_score.sql` | Phase 5 drift fix | Deduplicates and adds UNIQUE constraint on `tenant_risk_scores.tenant_id` |

---

## 7. Worker Queues & Processors

**Worker entry:** `apps/worker/src/index.ts`

| Queue (constant) | Redis name | Processor file | Concurrency | Jobs handled |
|-----------------|------------|----------------|------------|--------------|
| `QUEUES.INGEST` | `lynkbot-ingest` | `ingest.processor.ts` | 2 (lockDuration=5m) | PDF ingestion + LLM chunking |
| `QUEUES.TRACKING` | `lynkbot-tracking` | `tracking.processor.ts` | 10 | Shipment tracking updates |
| `QUEUES.PAYMENT_EXPIRY` | `lynkbot-payment-expiry` | `paymentExpiry.processor.ts` | 5 | Order expiry |
| `QUEUES.STOCK_RELEASE` | `lynkbot-stock-release` | `stockRelease.processor.ts` | 5 | Return stock to inventory |
| `QUEUES.RESTOCK_NOTIFY` | `lynkbot-restock-notify` | `restock.processor.ts` | 5 | Restock alerts |
| `QUEUES.FLOW_EXECUTION` | `lynkbot-flow-execution` | `flowExecution.processor.ts` | 20 (lockDuration=60s) | Flow node execution + delays |
| `QUEUES.TEMPLATE_SYNC` | `lynkbot-template-sync` | `templateSync.processor.ts` | 5 | Template status polling + quality sync |
| `QUEUES.RISK_SCORE` | `lynkbot-risk-score` | `riskScore.processor.ts` | 3 | Tenant risk score computation |

**Queue constants location:** `packages/shared/src/constants/queues.ts`

### Flow Execution Job Names

| Job name | Triggered by | Handler |
|----------|-------------|---------|
| `flow.execute_node` | FlowEngine | `flowEngine.executeNode(executionId, nodeId)` |
| `flow.resume_after_delay` | DELAY node processor | `flowEngine.executeNode(executionId, nodeId)` |
| `flow.check_time_triggers` | Cron (every 15min) | `flowEngine.evaluateTimeTriggers(tenantId?)` |
| `flow.broadcast_segment` | Re-engagement trigger | `flowEngine.broadcastToSegment(tenantId, flowId, segmentFilter)` |

### Template Sync Job Names

| Job name | Cron interval | Handler |
|----------|--------------|---------|
| `template.poll_pending` | Every 5 min | `svc.pollPending()` |
| `template.sync_quality` | Every 60 min | `svc.syncQualityRatings()` |

### Risk Score Job Names

| Job name | Handler |
|----------|---------|
| `risk.compute` | Compute score for single tenant (or all tenants if no `tenantId`) |

### Cron Seeding

Seed all repeatable jobs once after first deploy:
```bash
curl -X POST https://your-api.railway.app/internal/flows/seed-cron \
  -H "x-api-key: $LYNK_INTERNAL_API_KEY"
```
Source: `apps/api/src/routes/internal/cron.ts`

---

## 8. Flow Engine — Type System

**Source:** `packages/flow-engine/src/types.ts`

### NodeType Union

```typescript
type NodeType =
  | 'TRIGGER'              // Entry point; subtype in TriggerConfig.triggerType
  | 'SEND_TEMPLATE'        // Meta approved template
  | 'SEND_TEXT'            // Free text (24h session window only)
  | 'SEND_INTERACTIVE'     // Button / list message
  | 'SEND_MEDIA'           // Image / video / document (STUB — logs and exits)
  | 'DELAY'                // Enqueues BullMQ delayed job — never sleep() in-process
  | 'WAIT_FOR_REPLY'       // Pauses execution until inbound message
  | 'IF_CONDITION'         // Evaluates ConditionGroup → 'true' | 'false' port
  | 'KEYWORD_ROUTER'       // Matches inbound text → port by keyword index | 'default'
  | 'TAG_BUYER'            // Add/remove tag from buyers.tags JSONB
  | 'UPDATE_BUYER'         // Update displayName | notes | preferredLanguage
  | 'SEND_WINDOW'          // Time-of-day gate (Jakarta UTC+7) → 'outside' port if blocked
  | 'RATE_LIMIT'           // Redis counter for 1000/hr WABA limit
  | 'SEGMENT_QUALITY_GATE' // Buyer quality filter → 'excluded' port if fails
  | 'END_FLOW'             // Marks execution completed
```

### TriggerType

```typescript
type TriggerType =
  | 'button_click'     // Interactive button with payload 'flow:{flowId}:{buttonIndex}'
  | 'broadcast'        // Segment-targeted campaign
  | 'time_based'       // Cron expression (evaluateTimeTriggers cron)
  | 'inbound_keyword'  // Keyword match on inbound message
```

### FlowDefinition (stored as JSONB in flow_definitions.nodes)

```typescript
interface FlowDefinition {
  nodes: FlowNode[];   // Each node: { id, type, label?, config, position? }
  edges: FlowEdge[];   // Each edge: { id, source, target, sourcePort? }
}

// Edge source ports:
// 'default' — normal/fallthrough
// 'true' / 'false' — IF_CONDITION
// 'outside' — SEND_WINDOW (outside time window)
// 'excluded' — SEGMENT_QUALITY_GATE
// '0', '1', ... — KEYWORD_ROUTER (array index as string)
```

### ConditionGroup

```typescript
interface ConditionGroup {
  logic: 'AND' | 'OR';
  conditions: Condition[];
}

interface Condition {
  field: 'buyer.name' | 'buyer.phone' | 'buyer.totalOrders' | 'buyer.tags'
       | 'buyer.lastOrderAt' | 'trigger.type' | 'trigger.buttonPayload'
       | `flow.variable.${string}`;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains'
           | 'greater_than' | 'less_than' | 'is_set' | 'is_not_set'
           | 'days_since' | 'includes_tag' | 'not_includes_tag';
  value?: string | number | boolean;
}
```

### ExecutionContext

```typescript
interface ExecutionContext {
  executionId: string;
  flowId: string;
  tenantId: string;
  buyerId: string;
  buyer: BuyerContext;   // Snapshot of buyer at execution start
  trigger: TriggerContext;
  variables: Record<string, unknown>;  // Flow-scoped runtime vars
  executionLog: ExecutionLogEntry[];
  wabaId?: string;       // For rate limit Redis key
}
```

### Variable Resolution (`variableResolver.ts`)

Resolves template strings: `{{buyer.name}}`, `{{buyer.phone}}`, `{{buyer.totalOrders}}`, `{{order.code}}`, `{{flow.variable.X}}`. Unknown variables → empty string (never throw).

---

## 9. Flow Engine — Node Processors

**Location:** `packages/flow-engine/src/nodeProcessors/`

Each processor: `async (node, ctx, deps) => NodeResult`

| Processor file | Node type | Key behavior |
|---------------|-----------|--------------|
| `sendTemplate.ts` | SEND_TEMPLATE | CooldownChecker → resolveVariables → MetaClient.sendTemplate → log to buyer_broadcast_log → sleep(500ms) |
| `sendText.ts` | SEND_TEXT | doNotContact check → MetaClient.sendText (throws if outside 24h) → sleep(500ms) |
| `sendInteractive.ts` | SEND_INTERACTIVE | doNotContact check → sendText fallback (MetaClient lacks native sendInteractive) → sleep(500ms) |
| `sendMedia.ts` | SEND_MEDIA | STUB — logs "not implemented" → returns `{nextNodeId:'default'}` |
| `delay.ts` | DELAY | BullMQ `queue.add('flow.resume_after_delay', ..., { delay: node.config.delayMs })` → returns `{status:'delayed'}` |
| `waitForReply.ts` | WAIT_FOR_REPLY | Sets execution `status='waiting_reply'` → webhook resumes via `resumeExecution()` |
| `ifCondition.ts` | IF_CONDITION | `evaluateConditionGroup(node.config.conditions, ctx)` → returns `'true'` or `'false'` port |
| `keywordRouter.ts` | KEYWORD_ROUTER | Case-insensitive match of `ctx.trigger.messageText` against `node.config.keywords[]` → returns index string or `'default'` |
| `tagBuyer.ts` | TAG_BUYER | `db.update(buyers).set({tags: add/remove})` |
| `updateBuyer.ts` | UPDATE_BUYER | `db.update(buyers).set({[field]: resolveVariables(value, ctx)})` |
| `sendWindow.ts` | SEND_WINDOW | Jakarta time check → `'outside'` port if blocked |
| `rateLimit.ts` | RATE_LIMIT | Redis INCR `ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}` → `'default'` port if >= 1000 |
| `segmentQualityGate.ts` | SEGMENT_QUALITY_GATE | totalOrders > 0 OR has inbound history AND doNotContact=false → `'excluded'` if fails |
| `endFlow.ts` | END_FLOW | Updates `flow_executions.status='completed'`, decrements `buyers.activeFlowCount` |

**Processor registry:** `packages/flow-engine/src/nodeProcessors/index.ts` — maps `NodeType` → processor function.

### FlowEngine Core Methods

| Method | Location | Purpose |
|--------|----------|---------|
| `handleButtonTrigger(tenantId, buyerId, buttonPayload, conversationId?)` | `engine.ts` | Entry point for button tap events; parses `flow:{flowId}:{idx}`, loads flow, checks doNotContact + duplicate execution, inserts flow_executions row, calls `executeNode` |
| `executeNode(executionId, nodeId)` | `engine.ts` | Loads execution, finds node, calls processor, appends to log, follows edges, recurses |
| `resumeExecution(executionId, inboundMessage)` | `engine.ts` | Called when buyer sends message to a waiting_reply execution |
| `evaluateTimeTriggers(tenantId?)` | `engine.ts` | Cron job handler — scans `time_based` active flows, enqueues execution jobs |
| `broadcastToSegment(tenantId, flowId, segmentFilter)` | `engine.ts` | Fan-out — queries buyers, guards doNotContact + 1000/hr Redis cap, enqueues per-buyer execution jobs |

---

## 10. Compliance Rules (Hard Guards)

These are **non-negotiable** — never bypass or catch-and-swallow:

| # | Rule | Where enforced |
|---|------|---------------|
| 1 | Never `sendText()` outside 24h session window | `MetaClient.sendText()` throws; `sendText.ts` does NOT catch |
| 2 | `doNotContact=true` buyers excluded from ALL outbound paths | `sendText.ts`, `sendTemplate.ts`, `segmentQualityGate.ts`, `broadcastToSegment()` |
| 3 | STOP/BERHENTI → `doNotContact=true` + cancel active executions | `conversation.service.ts` → `db.update(buyers)` |
| 4 | Min 500ms between consecutive sends to same number | `await sleep(500)` in every send processor after MetaClient call |
| 5 | Max 1× same template per buyer per 7 days | `CooldownChecker.check()` → `7d_same_template` |
| 6 | Max 1000 marketing templates per WABA per hour | `rateLimit.ts` → Redis key `ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}` |
| 7 | DELAY node enqueues BullMQ job — never `sleep()` in-process | `delay.ts` → `queue.add(..., {delay: ms})` |
| 8 | AI-generated flows always `status: 'draft'` | `POST /v1/ai/generate-flow` — never calls `PATCH /v1/flows/:id/status` |

**Risk score gate:** `PATCH /v1/flows/:id/status` → 422 `risk_score_too_high` if score > 80.

**Appeal limit:** `POST /v1/flow-templates/:id/appeal` → 422 `appeal_limit_reached` if `appealCount >= 2`.

**Template in-use guard:** `DELETE /v1/flow-templates/:id` → 409 if template referenced by active flow.

**Per-tenant MetaClient:** Use `getTenantMetaClient(tenantId)` from `_meta.helper.ts`. Never `new MetaClient(config.META_ACCESS_TOKEN, ...)`.

---

## 11. Design Patterns & Idioms

### Route Pattern

```typescript
// Match apps/api/src/routes/v1/broadcasts.ts
import type { FastifyPluginAsync } from 'fastify';
import { requireFeature } from '../../middleware/featureGate';

export const myRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/resource', {
    preHandler: [fastify.authenticate, requireFeature('flow_builder')],
  }, async (request, reply) => {
    const tenantId = (request as any).user?.tenantId as string;
    // ... business logic
    return reply.send(result);
  });
};

// Register in apps/api/src/index.ts:
await server.register(myRoutes, { prefix: '/api' });
```

### DB Query Pattern

```typescript
import { db, flowDefinitions, eq, and } from '@lynkbot/db';

// Find one
const flow = await db.query.flowDefinitions.findFirst({
  where: and(
    eq(flowDefinitions.id, flowId),
    eq(flowDefinitions.tenantId, tenantId),
  ),
});

// Update (Drizzle builder)
await db.update(buyers)
  .set({ doNotContact: true })
  .where(eq(buyers.id, buyerId));

// Insert
await db.insert(buyerBroadcastLog).values({
  id: crypto.randomUUID(),
  tenantId,
  buyerId,
  templateName,
  sentAt: new Date(),
});
```

### Tenant MetaClient Pattern

```typescript
import { getTenantMetaClient } from '../_meta.helper';

// In any service method:
const meta = await this.getMetaClient(tenantId);

// In service class:
private async getMetaClient(tenantId: string) {
  return getTenantMetaClient(tenantId); // NEVER: new MetaClient(config.META_ACCESS_TOKEN, ...)
}
```

**CRITICAL:** `getMetaClient()` is **NOT async at call time** — it returns a Promise directly from `getTenantMetaClient()`. When mocking in tests, use `.mockResolvedValue()`, not `.mockReturnValue()`.

### Test Mock Pattern (vitest v1.6.x)

```typescript
// REQUIRED: vi.clearAllMocks() wipes vi.fn(implementation)!
// Re-establish all function mocks in beforeEach AFTER clearAllMocks()
beforeEach(() => {
  vi.clearAllMocks();

  // Re-establish function implementations:
  (extractText as any).mockImplementation((payload: any) => payload?.text ?? '');
  (isLocationMessage as any).mockImplementation(
    (payload: any) => payload?.messageType === 'location',
  );

  // Shared MetaClient mock object:
  mockMetaClient = {
    sendText: vi.fn().mockResolvedValue(undefined),
    sendTemplate: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
  };
  (getTenantMetaClient as any).mockResolvedValue(mockMetaClient);
});
```

### Vitest Mock Hoisting Pattern

```typescript
// For route tests — mock must be hoisted before vi.mock calls
const { mockDb, mockLLM } = vi.hoisted(() => ({
  mockDb: { query: { flowDefinitions: { findFirst: vi.fn() } } },
  mockLLM: { chat: vi.fn() },
}));

vi.mock('@lynkbot/db', () => ({ db: mockDb, eq: vi.fn(), and: vi.fn(), ... }));
vi.mock('@lynkbot/ai', () => ({ getLLMClient: () => mockLLM }));
```

### Drizzle Insert Mock (returns Promise AND builder)

```typescript
// Drizzle's db.insert().values() returns a Promise-AND-builder object
const mockReturning = vi.fn().mockResolvedValue([{ id: 'test-id' }]);
const mockInsert = Object.assign(Promise.resolve([]), {
  returning: mockReturning,
  onConflictDoNothing: vi.fn().mockReturnThis(),
});
(db.insert as any).mockReturnValue({ values: vi.fn().mockReturnValue(mockInsert) });
```

### AES-256-GCM Crypto

```typescript
import { encrypt, decrypt } from '../utils/crypto';

const encrypted = encrypt(plaintext, config.WABA_POOL_ENCRYPTION_KEY); // returns "iv:authTag:ciphertext"
const plaintext = decrypt(encrypted, config.WABA_POOL_ENCRYPTION_KEY);
```

Key must be 64 hex chars (32 bytes). Generate: `openssl rand -hex 32`.

### featureGate Middleware

```typescript
// apps/api/src/middleware/featureGate.ts
export type FeatureFlag =
  | 'flow_builder' | 'template_studio' | 'flow_reengagement'
  | 'ai_flow_generator' | 'risk_score';

export function requireFeature(feature: FeatureFlag) {
  return async (_request: FastifyRequest, _reply: FastifyReply) => {
    // Currently a pass-through stub — all authenticated tenants pass.
    // Plug in real tier checks here when business rules are finalized.
  };
}
```

All features are currently enabled for all authenticated tenants. Feature flags can be toggled via `FEATURE_*` env vars (see §14).

---

## 12. Dashboard UI — Pages & Components

**Stack:** Vite + React 18 + Tailwind CSS + React Query. Dark theme (slate palette, indigo accents).

**Entry:** `apps/dashboard/src/App.tsx` (all routes defined here)

**API client:** `apps/dashboard/src/lib/api.ts` — axios instance with JWT auth; all API namespaces exported.

### Page Map

| Route | Component | File |
|-------|-----------|------|
| `/dashboard` | Overview / home | pre-existing |
| `/dashboard/flows` | FlowsListPage | `pages/Flows/FlowsListPage.tsx` |
| `/dashboard/flows/new` | FlowEditorPage | `pages/Flows/FlowEditorPage.tsx` |
| `/dashboard/flows/:id/edit` | FlowEditorPage | `pages/Flows/FlowEditorPage.tsx` |
| `/dashboard/templates` | TemplateListPage | `pages/Templates/TemplateListPage.tsx` |
| `/dashboard/templates/new` | TemplateEditorPage | `pages/Templates/TemplateEditorPage.tsx` |
| `/dashboard/templates/:id/edit` | TemplateEditorPage | `pages/Templates/TemplateEditorPage.tsx` |
| `/dashboard/buyers` | BuyersPage | pre-existing (reference for dark theme style) |

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `Sidebar` | `components/Sidebar.tsx` | Nav links: includes Flows (⚡) + Templates entries |
| `RiskScoreGauge` | `components/RiskScoreGauge.tsx` | SVG half-arc gauge; fetches `/api/v1/risk-score` on mount; compact variant available |
| `TemplatePreview` | `pages/Templates/components/TemplatePreview.tsx` | WhatsApp dark-green bubble mockup; updates live |

### FlowEditorPage — Drawflow Integration

- **Library:** `drawflow@0.0.60` (pinned in `apps/dashboard/package.json`)
- **CSS:** `import 'drawflow/dist/drawflow.min.css'` (must import this, not `src/drawflow.css`)
- **Type shim:** `apps/dashboard/src/declarations.d.ts` (no official `@types/drawflow`)
- **Pattern:** Initialized via `useRef + useEffect`; `editor.export()` / `editor.import()` for serialization
- **12-node palette:** drag-to-add (SEND_TEMPLATE, SEND_TEXT, SEND_INTERACTIVE, DELAY, WAIT_FOR_REPLY, IF_CONDITION, KEYWORD_ROUTER, TAG_BUYER, UPDATE_BUYER, SEND_WINDOW, RATE_LIMIT, END_FLOW)
- **AI panel:** inline text field + "Generate" → `POST /api/v1/ai/generate-flow` → loads `FlowDefinition` into canvas

### Dashboard API Client Namespaces

```typescript
// apps/dashboard/src/lib/api.ts
flowsApi.list(params?)                                    // GET /flows
flowsApi.get(id)                                          // GET /flows/:id
flowsApi.create(data)                                     // POST /flows
flowsApi.update(id, data)                                 // PUT /flows/:id
flowsApi.updateStatus(id, status)                         // PATCH /flows/:id/status
flowsApi.delete(id)                                       // DELETE /flows/:id
flowsApi.getExecutions(id, params?)                       // GET /flows/:id/executions
flowsApi.test(id)                                         // POST /flows/:id/test

flowTemplatesApi.list(params?)                            // GET /flow-templates
flowTemplatesApi.get(id)                                  // GET /flow-templates/:id
flowTemplatesApi.create(data)                             // POST /flow-templates
flowTemplatesApi.update(id, data)                         // PUT /flow-templates/:id
flowTemplatesApi.submit(id)                               // POST /flow-templates/:id/submit
flowTemplatesApi.appeal(id)                               // POST /flow-templates/:id/appeal
flowTemplatesApi.pause(id)                                // POST /flow-templates/:id/pause
flowTemplatesApi.delete(id)                               // DELETE /flow-templates/:id

riskScoreApi.get()                                        // GET /risk-score
riskScoreApi.compute()                                    // POST /risk-score/compute

aiApi.generateFlow({ prompt, productId?, audienceSegment? })   // POST /ai/generate-flow
aiApi.modifyFlow({ flowId, instruction })                      // POST /ai/modify-flow

onboardingApi.complete(data)                              // POST /onboarding/complete
onboardingApi.status()                                    // GET /onboarding/status
```

---

## 13. Authentication & Middleware

| Middleware | File | Behavior |
|-----------|------|----------|
| JWT auth | `apps/api/src/plugins/auth.ts` | `fastify.authenticate` preHandler; populates `request.user.tenantId` |
| Feature gate | `apps/api/src/middleware/featureGate.ts` | `requireFeature(flag)` — stub pass-through; pluggable |
| Internal API key | `apps/api/src/middleware/internalApiKey.ts` | Checks `x-internal-api-key` header === `config.LYNK_INTERNAL_API_KEY` |
| Meta HMAC | `apps/api/src/middleware/metaSignature.ts` | Verifies `x-hub-signature-256` on Meta webhook |
| Rate limit | `apps/api/src/plugins/rateLimit.ts` | Global request rate limit |
| CORS | `apps/api/src/plugins/cors.ts` | Set `CORS_ORIGIN` to dashboard domain |

**Tenant extraction in routes:**
```typescript
const tenantId = (request as any).user?.tenantId as string;
```

---

## 14. Environment Variables

### Shared (API + Worker)

```bash
DATABASE_URL=postgresql://...        # Auto-set by Railway PostgreSQL plugin
REDIS_URL=redis://...                # Auto-set by Railway Redis plugin
JWT_SECRET=<min 32 chars, random>
LYNK_INTERNAL_API_KEY=<min 10 chars>
XAI_API_KEY=<from console.x.ai>
WABA_POOL_ENCRYPTION_KEY=<64 hex chars>   # openssl rand -hex 32
META_ACCESS_TOKEN=<system user token>      # Fallback only; per-tenant tokens stored in DB
META_PHONE_NUMBER_ID=<phone number id>
META_WABA_ID=<waba id>
META_APP_SECRET=<app secret>              # HMAC webhook verification
META_WEBHOOK_VERIFY_TOKEN=<token>
META_API_VERSION=v23.0
PAYMENT_PROVIDER=midtrans
MIDTRANS_SERVER_KEY=<key>
MIDTRANS_CLIENT_KEY=<key>
MIDTRANS_IS_PRODUCTION=false
RAJAONGKIR_API_KEY=<key>
GOOGLE_MAPS_API_KEY=<key>
S3_BUCKET=<bucket>
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
```

### Feature Flags (API only, all default `true`)

```bash
FEATURE_FLOW_BUILDER=true
FEATURE_TEMPLATE_STUDIO=true
FEATURE_FLOW_REENGAGEMENT=true
FEATURE_AI_FLOW_GENERATOR=true
```

Set to `'false'` to hard-disable a feature while business rules are being finalized.

### LLM Config

```bash
XAI_BASE_URL=https://api.x.ai/v1
LLM_MODEL=grok-4-1-fast-reasoning
LLM_PROVIDER=xai
LLM_FALLBACK_MODEL=grok-3
```

### API Only

```bash
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://your-dashboard.railway.app
WORKER_CONCURRENCY=5
```

### Dashboard Only

```bash
VITE_API_BASE_URL=https://your-api.railway.app   # Build-time; must be prefixed VITE_
```

### Optional

```bash
APIFY_API_KEY=<key>     # LinkedIn/Instagram OSINT; gracefully skipped if unset
SERPER_API_KEY=<key>    # Google Search; gracefully skipped if unset
SENTRY_DSN=<dsn>
LOG_LEVEL=info          # debug | info | warn | error
```

---

## 15. Testing — Files & Patterns

**Framework:** Vitest v1.6.x. Configuration: `apps/api/vitest.config.ts`.

**Vitest config (as of Phase 6):**
```typescript
// apps/api/vitest.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    exclude: ['**/node_modules/**'],  // conversation.service.test.ts is NOW included
  },
});
```

### Test File Index

| File | Tests | What it covers |
|------|-------|---------------|
| `apps/api/src/services/__tests__/conversation.service.test.ts` | 20 | State machine: STOP/AGENT, location, escape hint, detectLanguage, ESCALATED, isDuplicate, CLOSED_LOST; idempotency |
| `apps/api/src/routes/__tests__/ai.test.ts` | 16 | `POST /v1/ai/generate-flow` + `POST /v1/ai/modify-flow`: 400/404/502, response shape, warnings, fence fallback, tenant guard, `requireFeature` |
| `apps/api/src/routes/__tests__/flowTemplates.test.ts` | 20 | Template CRUD, submit mock, appeal 422, delete 409, status update |
| `apps/api/src/utils/__tests__/crypto.test.ts` | 8 | AES-256-GCM: round-trip, wrong key, malformed input, IV uniqueness |

**Total: 64/64 passing** (as of Phase 6, commit `de032ee`)

### Unit Tests in flow-engine (Phase 2)

| File | Tests |
|------|-------|
| `packages/flow-engine/src/__tests__/variableResolver.test.ts` | 16 |
| `packages/flow-engine/src/__tests__/conditionEvaluator.test.ts` | 31 |
| `packages/flow-engine/src/__tests__/riskScoreCalculator.test.ts` | 11 |
| `packages/flow-engine/src/__tests__/cooldownChecker.test.ts` | 7 |
| `packages/flow-engine/src/__tests__/engine.test.ts` | 12 |

**Total flow-engine: 77/77 passing**

### Running Tests

```bash
# From worktree root (resolves to api package):
cd apps/api && npx vitest run

# Or from worktree root:
pnpm -F api exec vitest run

# NOTE: Do NOT use `pnpm -F api test` if you're running from a worktree
# that differs from the main repo — use npx vitest run from the apps/api dir directly.
```

### Test Docker Image

```bash
docker build -f Dockerfile.test -t lynkbot-test .
docker run lynkbot-test sh -c "cd apps/api && npx vitest run"
```

---

## 16. Build Order & Commands

### Type-check all packages

```bash
pnpm -F @lynkbot/flow-engine typecheck   # Zero errors required
pnpm -F api typecheck                     # Zero errors required
pnpm -F worker typecheck                  # Zero errors required
pnpm -F dashboard typecheck               # Uses declarations.d.ts for drawflow shim
```

### Typecheck Pre-existing Errors (expected, not our problem)

These files have pre-existing type errors from unbuilt optional packages (`@lynkbot/ai`, `@lynkbot/pantheon`, `@lynkbot/payments`). These are expected and not new:
- `apps/api/src/routes/v1/intelligence.ts`
- `apps/api/src/services/conversation.service.ts` (when not built with those packages)
- `apps/api/src/services/payment.service.ts`

---

## 17. Deployment — Railway Runbook

Full guide: `docs/RAILWAY_DEPLOYMENT.md`

### Services

| Railway Service | Source | Build Command | Start Command |
|----------------|--------|---------------|---------------|
| `lynkbot-api` | monorepo root | `pnpm install && pnpm -F @lynkbot/shared build && ... && pnpm -F api build` | `pnpm -F api start` |
| `lynkbot-worker` | monorepo root | same build order → `pnpm -F worker build` | `pnpm -F worker start` |
| `lynkbot-dashboard` | monorepo root | `pnpm install && pnpm -F dashboard build` | `pnpm -F dashboard preview` |

### Migration Strategy

Set **Release Command** on `lynkbot-api`:
```
pnpm -F @lynkbot/db migrate
```
Runs before new container starts — additive-only changes are zero-downtime safe.

### First Deploy (7 steps)

```bash
# 1. Set all required env vars in Railway for api + worker
# 2. Deploy from main branch (Railway auto-builds)
# 3. Verify migration ran (check Railway logs or run manually)
# 4. Verify health:
curl https://your-api.railway.app/health
# → {"status":"ok","version":"0.1.0",...}

# 5. Seed cron jobs (once only):
curl -X POST https://your-api.railway.app/internal/flows/seed-cron \
  -H "x-api-key: $LYNK_INTERNAL_API_KEY"

# 6. Configure Meta webhook in Meta Developer Console:
#    Callback URL: https://your-api.railway.app/webhooks/meta
#    Subscribe: messages, message_template_status_update, phone_number_quality_update

# 7. Create first tenant + register WABA credentials:
#    POST /api/v1/onboarding/complete { mode: 'pool' } or { mode: 'manual', ... }
#    OR seed directly: POST /internal/waba-pool
```

### Healthchecks

- **API:** `GET /health` → 200 `{"status":"ok"}` — set Railway path to `/health`, timeout 10s, interval 30s
- **Worker:** No HTTP port — use Railway process restart policy (On Failure, max 3 retries, 60s backoff)
- **Dashboard:** `GET /` — Railway auto-detects port

### Security Checklist (must verify before production)

- [ ] `JWT_SECRET` ≥ 32 chars, cryptographically random
- [ ] `WABA_POOL_ENCRYPTION_KEY` exactly 64 hex chars
- [ ] `META_APP_SECRET` set — HMAC webhook verification enforced in production
- [ ] `META_WEBHOOK_VERIFY_TOKEN` changed from default
- [ ] `NODE_ENV=production` on API and Worker
- [ ] `CORS_ORIGIN` set to exact dashboard domain (not `*`)
- [ ] `MIDTRANS_IS_PRODUCTION=true` after testing complete
- [ ] `LYNK_INTERNAL_API_KEY` not guessable; `/internal/**` routes not publicly exposed

---

## 18. PRD vs Implementation — Divergences

These are intentional divergences from `LynkBot_Flow_Engine_PRD_v2.1.md`. Do not "fix" these — they are decisions made during implementation.

| PRD Spec | Built Approach | Rationale |
|----------|---------------|-----------|
| `TRIGGER_BROADCAST_REPLY`, `TRIGGER_INBOUND_KEYWORD`, etc. as NodeType variants | Single `TRIGGER` type + `TriggerConfig.triggerType` subfield | Cleaner; trigger subtype lives in config, not the union |
| `FlowEdge.sourceNodeId` / `targetNodeId` | `FlowEdge.source` / `FlowEdge.target` | Industry convention (matches Reactflow/d3); changing requires data migration |
| Separate components `FlowCanvas.tsx`, `NodePalette.tsx`, `PropertiesPanel.tsx`, `AIAssistantPanel.tsx` | All inlined in `FlowEditorPage.tsx` | No cross-file reuse needed at this stage |
| `sendInteractive` using native button/list message | Falls back to `sendText` for body text | MetaClient lacks `sendInteractive` method; Phase 5/6 deferred this |
| `risk_score_formula` weights in PRD §8.1 | Implemented with slight weight adjustments | Final formula: broadcastFreq×0.35, templateQuality×0.25, blockProxy×0.20, optInConfidence×0.15, sendSpeed×0.05 |

---

## 19. Known Debt & Stubs

These are explicitly deferred items — not bugs, but incomplete features:

| Item | File | Status |
|------|------|--------|
| `SEND_MEDIA` node | `packages/flow-engine/src/nodeProcessors/sendMedia.ts` | STUB — logs and returns `{nextNodeId:'default'}` |
| `sendInteractive` native button/list | `packages/flow-engine/src/nodeProcessors/sendInteractive.ts` | Falls back to `sendText`; MetaClient needs `sendInteractive` method |
| `featureGate` real tier checks | `apps/api/src/middleware/featureGate.ts` | STUB — all authenticated tenants pass; business rules not finalized |
| Risk score hourly cron seeding | `apps/api/src/routes/internal/cron.ts` | Not seeded by `/internal/flows/seed-cron`; can add `risk.compute` as repeatable job |
| `riskScoreEstimate` in broadcast route | `apps/api/src/routes/v1/broadcasts.ts` | Not wired to actual risk score |
| WABA pool seed data | `infra/scripts/seed-waba-pool.ts` | TODOs need real Meta Cloud API credentials before running |
| `SET_VARIABLE` node type | Not implemented | PRD mentions flow-scoped runtime variables; `ExecutionContext.variables` exists but no node writes to it |

---

## Quick Reference — Most Common Tasks

### Add a new API route

1. Create route file at `apps/api/src/routes/v1/myFeature.ts` (copy pattern from `broadcasts.ts`)
2. Import and register in `apps/api/src/index.ts` with `{ prefix: '/api' }`
3. Add API client method to `apps/dashboard/src/lib/api.ts`

### Add a new flow node type

1. Add to `NodeType` union in `packages/flow-engine/src/types.ts`
2. Add `Config` interface and add to `NodeConfig` union in `types.ts`
3. Create processor in `packages/flow-engine/src/nodeProcessors/myNode.ts`
4. Register in `packages/flow-engine/src/nodeProcessors/index.ts`
5. Add to palette in `apps/dashboard/src/pages/Flows/FlowEditorPage.tsx`

### Add a new worker processor

1. Create `apps/worker/src/processors/myFeature.processor.ts`
2. Add queue constant to `packages/shared/src/constants/queues.ts`
3. Register in `apps/worker/src/index.ts` with `new Worker(QUEUES.MY_QUEUE, processor, { connection, concurrency })`

### Add a new DB table

1. Create schema file in `packages/db/src/schema/myTable.ts`
2. Export from `packages/db/src/schema/index.ts`
3. Write SQL migration in `packages/db/src/migrations/000N_description.sql`
4. Run `pnpm -F @lynkbot/db migrate` or use Railway Release Command

### Run full quality check before commit

```bash
pnpm -F @lynkbot/flow-engine build
pnpm -F api typecheck
pnpm -F worker typecheck
cd apps/api && npx vitest run   # 64/64 must pass
```
