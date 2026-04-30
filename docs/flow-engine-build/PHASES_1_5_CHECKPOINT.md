# Phases 1–5 Checkpoint — LynkBot Flow Engine v2.1

> **Branch:** `claude/elegant-brattain-b5512a`
> **Last commit:** `880753d` (PRD drift fixes)
> **PRD reference:** `LynkBot_Flow_Engine_PRD_v2.1.md` (project root)
> **Purpose:** Single-page audit record for all completed work. Phase 6 agent reads this + PHASE_5_HANDOFF.md.

---

## Overall Status

| Phase | Scope | Status | Tests |
|-------|-------|--------|-------|
| 1 | DB schema + migrations + featureGate + crypto + WABA pool | ✅ Complete | — (infrastructure only) |
| 2 | FlowEngine package + CRUD routes + worker processor | ✅ Complete | 77/77 unit |
| 3 | TemplateStudioService + dashboard pages | ✅ Complete | 28/28 integration |
| 4 | Risk scoring + re-engagement + webhook handlers | ✅ Complete | 28/28 integration |
| 5 | AI flow generation + dashboard flows UI + PRD drift fixes | ✅ Complete | 28/28 integration |
| **6** | **Conversation test fix + AI route tests + deployment guide** | 🔲 **Next** | — |

---

## Phase 1 — Foundation

**Commits:** `52b1d4e` → `94d9595`

### Delivered
- **Migration `0005_flow_engine.sql`** — creates: `flow_definitions`, `flow_executions`, `flow_templates`, `buyer_broadcast_log`, `tenant_risk_scores`, `waba_pool`; ALTERs `tenants`, `broadcasts`, `buyers`
- **6 new Drizzle schema files** in `packages/db/src/schema/`: `wabaPool.ts`, `flowDefinitions.ts`, `flowExecutions.ts`, `flowTemplates.ts`, `buyerBroadcastLog.ts`, `tenantRiskScores.ts`
- **`MetaClient.fromTenant(tenant)`** static factory (per-tenant credential isolation — PRD §4)
- **`WabaPoolService`** — assign/release WABA numbers from pool; tokens stored AES-256-GCM encrypted
- **`AES-256-GCM crypto util`** (`apps/api/src/utils/crypto.ts`) — random IV per encrypt, HMAC-authenticated
- **`featureGate` middleware** (`apps/api/src/middleware/featureGate.ts`) — stub, all flags pass; pluggable for real tier rules
- **Updated `QUEUES`** constants — removed `WATI_STATUS`, added `FLOW_EXECUTION`, `TEMPLATE_SYNC`, `RISK_SCORE`
- **Deleted dead code** — `watiStatus.processor.ts`, `DEPLOYMENT.md`
- **Onboarding two-path UX** — pool assignment or manual Meta credential entry

### Key Invariants Established
- All tenant WhatsApp sends go through `MetaClient.fromTenant(tenant)` — never `config.META_ACCESS_TOKEN` directly
- All WABA pool access tokens stored encrypted; `WABA_POOL_ENCRYPTION_KEY` env var required
- `doNotContact` check enforced at every send path

---

## Phase 2 — Flow Engine Package

**Commits:** `669faa9` → `15bab52`

### Delivered
- **`packages/flow-engine`** — standalone TypeScript package; exports `FlowEngine`, all node processors, type definitions
- **`FlowEngine` class** — `handleButtonTrigger`, `executeNode`, `resumeExecution`, `evaluateTimeTriggers`, `broadcastToSegment`
- **13 node processors** in `packages/flow-engine/src/nodeProcessors/` — one per `NodeType`; registered via `processorRegistry`
- **Helper utilities** — `variableResolver.ts`, `conditionEvaluator.ts`, `cooldownChecker.ts`, `riskScoreCalculator.ts`
- **CRUD routes** — `apps/api/src/routes/v1/flows.ts` — 8 endpoints; all behind `requireFeature('flow_builder')` + risk score gate on PATCH /status
- **Worker processor** — `apps/worker/src/processors/flowExecution.processor.ts`
- **Seed cron** — `POST /internal/flows/seed-cron`
- **77 unit tests** — all processors + engine integration scenarios

### Key Design Decisions
- `FlowDefinition` uses `FlowEdge.source`/`FlowEdge.target` (industry convention matching Reactflow; intentional divergence from PRD's `sourceNodeId`/`targetNodeId` — no functional impact since edges stored as JSONB)
- `TRIGGER` is a single NodeType; subtype captured in `TriggerConfig.triggerType` — cleaner than granular `TRIGGER_BROADCAST_REPLY` etc.

---

## Phase 3 — Template Studio

**Commits:** `87faa06` → `383f0fd`

### Delivered
- **`TemplateStudioService`** (`apps/api/src/services/templateStudio.service.ts`) — CRUD, Meta Graph v23.0 submit, appeal enforcement (max 2), status update handler, `validateForFlowUse`
- **8 REST endpoints** at `/v1/flow-templates` — all behind `requireFeature('template_studio')`; DELETE blocked if template referenced by active flow; POST /:id/appeal blocked if `appealCount >= 2`
- **`templateSync.processor.ts`** — worker processor for template sync jobs
- **Dashboard pages** — `TemplatesListPage.tsx`, `TemplateEditorPage.tsx`; sidebar entry; routes in App.tsx
- **`Dockerfile.test`** — reproducible Docker test image for CI; `pnpm install --frozen-lockfile` + build order: shared → meta → db → flow-engine
- **28/28 integration tests** — `flowTemplates.test.ts` pattern: `vi.hoisted` + `vi.mock` + `vi.clearAllMocks` in `beforeEach`

### Compliance Guards
- `appealCount >= 2` → 422 `appeal_limit_reached` (non-overridable, PRD §7)
- Template status state machine enforced at service layer

---

## Phase 4 — Risk Scoring + Re-engagement

**Commits:** `c8a26e8` → `227f42f`

### Delivered
- **`RiskScoreService`** (`apps/api/src/services/riskScore.service.ts`) — `getForTenant` (1h TTL cache via DB), `computeAndStore`, `handleQualityUpdate`; PRD §8.1 formula with 5 weighted factors
- **Risk score routes** — `GET /v1/risk-score`, `POST /v1/risk-score/compute`; both behind `fastify.authenticate`
- **`riskScore.processor.ts`** — worker processor for `risk.compute` BullMQ jobs
- **Meta webhook handlers** — `template_status_update` → `TemplateStudioService.handleStatusUpdate`; `phone_number_quality_update` → `RiskScoreService.handleQualityUpdate`
- **`FlowEngine.evaluateTimeTriggers`** — real implementation; queries active flows with `time_based` trigger, enqueues execution jobs
- **`FlowEngine.broadcastToSegment`** — real implementation; queries segment + respects `doNotContact`, `activeFlowCount` limits, logs to `buyer_broadcast_log`
- **28/28 tests** — same suite as Phase 3 (no new test files added; Phase 4 changes are logic + service layer)

### Risk Score Formula (PRD §8.1)
```
score = (broadcastFrequency × 0.35) + (templateQuality × 0.25) +
        (blockProxy × 0.20) + (optInConfidence × 0.15) + (sendSpeed × 0.05)
```
- `score > 80` → activation blocked (non-overridable, PATCH /v1/flows/:id/status returns 422)
- `score > 60` → warning added to response

---

## Phase 5 — AI Flow Generation + Dashboard UI + PRD Drift Fixes

**Commits:** `fe1f782` → `880753d`

### Delivered
- **`flowGeneration.ts`** (`packages/flow-engine/src/prompts/`) — `FLOW_GENERATION_SYSTEM_PROMPT`, `FLOW_MODIFICATION_SYSTEM_PROMPT` (bilingual EN/ID), `buildFlowGenPrompt`, `buildFlowModPrompt`
- **AI routes** — `POST /v1/ai/generate-flow` + `POST /v1/ai/modify-flow`; both behind `requireFeature('ai_flow_generator')` (PRD §11)
- **`RiskScoreGauge.tsx`** — SVG half-arc gauge; 4-band coloring (green 1-30 / yellow 31-60 / orange 61-80 / red 81-100, PRD §13.5); fetches on mount; compact inline variant
- **`FlowsListPage.tsx`** — paginated flow table, status filter, RiskScoreGauge banner, per-row actions (activate/pause/archive/test)
- **`FlowEditorPage.tsx`** — Drawflow canvas (drawflow@0.0.60); 12-node drag-to-add palette; inline `NodeConfigEditor`; AI generate/modify panel; CSS: `drawflow/dist/drawflow.min.css` (PRD §13.3)
- **`Sidebar.tsx` + `App.tsx`** — Flows nav entry (⚡), three routes added
- **`api.ts`** — `flowsApi`, `riskScoreApi`, `aiApi.generateFlow`/`aiApi.modifyFlow` client extensions
- **Migration `0006_unique_tenant_risk_score.sql`** — adds `UNIQUE` index on `tenant_risk_scores.tenant_id` (PRD §10); safe deduplicate-then-create
- **`tenantRiskScores.ts` schema** — `uniqueIndex` on `tenantId`
- **`riskScore.service.ts`** — migrated from delete-then-insert to `onConflictDoUpdate` upsert
- **28/28 tests** still passing after all changes

### Known Intentional Divergences from PRD
| PRD Spec | Built Approach | Rationale |
|----------|---------------|-----------|
| `TRIGGER_BROADCAST_REPLY`, `TRIGGER_INBOUND_KEYWORD` etc. as NodeType | Single `TRIGGER` type + `TriggerConfig.triggerType` | Cleaner; trigger subtype in config, not type union |
| `FlowEdge.sourceNodeId` / `targetNodeId` | `FlowEdge.source` / `target` | Industry convention; renaming requires data migration |
| `FlowCanvas.tsx`, `NodePalette.tsx`, `PropertiesPanel.tsx`, `AIAssistantPanel.tsx` as separate files | All inlined in `FlowEditorPage.tsx` | Simplicity; no cross-file reuse required |

---

## Current Test Count

```
pnpm -F api exec vitest run
  ✓ flowTemplates.test.ts   20/20
  ✓ crypto.test.ts           8/8
  Total: 28/28 passed
```

`conversation.service.test.ts` is excluded from vitest (`apps/api/vitest.config.ts`) — broken mock is the Phase 6 fix target.

---

## Files Excluded / Pre-existing Errors (not introduced by this build)

The following files have TypeScript errors that pre-date the flow engine build and are excluded from `vitest.config.ts` or noted as pre-existing in typecheck:
- `apps/api/src/routes/v1/ai.ts` — `@lynkbot/ai` not built in Docker test image (type errors only in Docker)
- `apps/api/src/routes/v1/intelligence.ts` — `@lynkbot/pantheon` + `@lynkbot/ai` not in Docker
- `apps/api/src/services/conversation.service.ts` — same
- `apps/api/src/services/payment.service.ts` — `@lynkbot/payments` not in Docker

All Phase 1–5 files have zero new TypeScript errors.

---

## Key Environment Variables (for Phase 6 deployment guide)

| Service | Var | Purpose |
|---------|-----|---------|
| API | `DATABASE_URL` | Postgres connection |
| API | `REDIS_URL` | BullMQ + rate limiting |
| API | `META_ACCESS_TOKEN` | Fallback Meta access token |
| API | `META_PHONE_NUMBER_ID` | Fallback phone number ID |
| API | `WABA_POOL_ENCRYPTION_KEY` | 32-byte hex; encrypts WABA pool tokens |
| API | `GROK_API_KEY` | xAI/Grok key for AI routes |
| API | `JWT_SECRET` | Auth token signing |
| Worker | `DATABASE_URL`, `REDIS_URL` | Same as API |
| Dashboard | `VITE_API_BASE_URL` | API base URL for client |

---

## What Phase 6 Must Do

See `PHASE_5_HANDOFF.md` §"Phase 6 Deliverables" for the full spec. Summary:

1. **Fix `conversation.service.test.ts`** — add `eq`, `and`, `or`, `ne`, `gte`, `lte`, `isNull`, `isNotNull`, `inArray`, `sql` to the `vi.mock('@lynkbot/db', ...)` factory; remove from `vitest.config.ts` exclude list
2. **Add `apps/api/src/routes/__tests__/ai.test.ts`** — integration tests for generate-flow + modify-flow (mock LLM client, verify response shape, tenant guard)
3. **Add `apps/dashboard/src/declarations.d.ts`** — `declare module 'drawflow'` shim for dashboard typecheck
4. **Write `docs/RAILWAY_DEPLOYMENT.md`** — per-service env vars, secrets, Railway linking pattern, healthchecks, migration strategy
5. **Verify worker typecheck** still clean (unchanged from Phase 4)

**Quality gates to pass:**
```bash
pnpm -F @lynkbot/flow-engine build  # clean
pnpm -F api typecheck               # zero errors in Phase 5+6 files
pnpm -F worker typecheck            # zero errors
pnpm -F api test                    # ALL tests passing (including conversation.service)
```
