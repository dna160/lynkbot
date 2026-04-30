# Phase 6 Handoff — Test Suite Completion + Production Readiness

> **Read first (in order):**
> 1. `LynkBot_Flow_Engine_PRD_v2.1.md` (project root — north star, authoritative)
> 2. `docs/flow-engine-build/PHASE_PLAN.md` (orchestration overview + compliance invariants)
> 3. `docs/flow-engine-build/PHASE_5_HANDOFF.md` (Phase 5 result — AI routes + dashboard)
> 4. `docs/flow-engine-build/PHASES_1_5_CHECKPOINT.md` (full audit record, Phases 1–5)
> 5. `docs/RAILWAY_DEPLOYMENT.md` (env vars, migration strategy, healthchecks)
> 6. This file (`PHASE_6_HANDOFF.md`) — Phase 6 deliverables and result

---

## Phase 6 Result

**Status: COMPLETE** — all Phase 6 deliverables committed, 64/64 tests passing, zero TypeScript errors.

**Last commit:** `de032ee` on branch `claude/elegant-brattain-b5512a`

---

## What Phase 6 Delivered

### 1. Full Vitest Test Suite — 64/64 Passing

Four test files, all passing:

| File | Tests | Notes |
|------|-------|-------|
| `src/services/__tests__/conversation.service.test.ts` | 20 | State machine: idempotency, STOP/AGENT, location, escape hint, detectLanguage, ESCALATED, isDuplicate, CLOSED_LOST |
| `src/routes/__tests__/ai.test.ts` | 16 | AI routes: generate-flow + modify-flow (400/404/502, response shape, warnings, fence fallback, tenant guard, requireFeature) |
| `src/routes/__tests__/flowTemplates.test.ts` | 20 | Pre-existing; confirmed still passing |
| `src/utils/__tests__/crypto.test.ts` | 8 | Pre-existing; confirmed still passing |

### 2. `conversation.service.test.ts` — Root Cause + Fix

**Root causes (three distinct issues):**

1. **`vi.clearAllMocks()` wipes function implementations** (vitest v1.6.x behaviour): `extractText`, `isLocationMessage`, and `getTenantMetaClient` all returned `undefined` after clear. Fixed by re-establishing all implementations in `beforeEach` after the clear call.

2. **`getTenantMetaClient` returning `undefined` → `.catch()` crash** (line 285 in service): `this.getMetaClient(tenantId)` is NOT async — it returns the bare return value of `getTenantMetaClient()`. When that was `undefined`, calling `.catch()` on it threw `TypeError: Cannot read properties of undefined (reading 'catch')`. Fixed by adding `(getTenantMetaClient as any).mockResolvedValue(mockMetaClient)` in `beforeEach`.

3. **Escape hint tests used wrong mock target**: Tests set up `(MetaClient as any).mockImplementation(...)` but `sendAiResponse` calls `this.getMetaClient()` → `getTenantMetaClient()`, never `new MetaClient()`. Fixed by introducing a shared `mockMetaClient` object (created in `beforeEach`) that tests inspect directly.

**Bonus fix:** STOP test assertion changed from `expect(db.execute).toHaveBeenCalled()` to `expect(db.update).toHaveBeenCalled()` — the service uses Drizzle's `db.update()`, not raw `db.execute()`.

### 3. `ai.test.ts` (NEW)

16 integration tests for the two AI routes. Uses `vi.hoisted` + `vi.mock` pattern matching `flowTemplates.test.ts`. Covers:
- Input validation (400 for missing/empty fields)
- Tenant isolation (404 when flow belongs to different tenant)
- LLM error → 502
- Markdown fence extraction fallback
- Compliance warnings (missing DELAY / END_FLOW nodes)
- `requireFeature` guard in place
- `buildFlowGenPrompt` / `buildFlowModPrompt` called with correct context

### 4. `declarations.d.ts` (NEW)

`apps/dashboard/src/declarations.d.ts` — Drawflow type shim so `pnpm -F dashboard typecheck` passes cleanly. Declares the subset of Drawflow API used in `FlowEditorPage.tsx`.

### 5. `Dockerfile.test` Updated

Added `pnpm -F @lynkbot/payments build || true` and `pnpm -F @lynkbot/wati build || true` so the full workspace is resolvable when running the test container in CI.

### 6. `docs/RAILWAY_DEPLOYMENT.md` (NEW)

Complete Railway deployment guide per PRD §14:
- All env vars documented per service (API, Worker, Dashboard)
- Railway plugin linking (PostgreSQL + Redis)
- Build commands in dependency order
- Migration strategy (Release Command pattern)
- Healthcheck config (`GET /health` for API, process restart for Worker)
- Meta webhook setup
- First-deploy runbook (7 steps)
- Rollback procedures
- Security checklist

---

## Files Created / Modified in Phase 6

### Created
- `apps/api/src/routes/__tests__/ai.test.ts` — 16 AI route integration tests
- `apps/dashboard/src/declarations.d.ts` — Drawflow type shim
- `docs/RAILWAY_DEPLOYMENT.md` — full Railway deployment guide

### Modified
- `apps/api/src/services/__tests__/conversation.service.test.ts` — 20 tests; all mock issues fixed
- `apps/api/vitest.config.ts` — removed `conversation.service.test.ts` from exclude list
- `Dockerfile.test` — added `@lynkbot/payments` + `@lynkbot/wati` build steps

---

## Quality Gates (all green)

```bash
pnpm -F @lynkbot/flow-engine build  # ✓ clean
pnpm -F api typecheck               # ✓ 0 errors
pnpm -F worker typecheck            # ✓ 0 errors
vitest run (64 tests)               # ✓ 64/64 passed
```

---

## Commit History (Phase 6)

```
de032ee test(phase6): complete vitest suite — 64/64 tests passing
```

---

## What Comes After Phase 6

The Flow Engine v2.1 implementation is **feature-complete** across all phases. Remaining work is operational:

1. **Merge to main**: Create PR from `claude/elegant-brattain-b5512a` → `main`
2. **Railway deploy**: Follow `docs/RAILWAY_DEPLOYMENT.md` runbook
3. **WABA pool seeding**: Register per-tenant credentials via `/v1/admin/waba-pool` or direct DB insert
4. **Feature flag tuning**: All features default ON; adjust via Railway env vars if needed
5. **Risk score baseline**: First compute run seeds `tenant_risk_scores`; monitor for score > 80 before allowing flows to activate
6. **Ongoing**: Monitor BullMQ queue health, Meta webhook delivery rate, LLM latency

---

## Working Directory

`/Users/storytellers/Documents/Claude Home/Lynkbot/.claude/worktrees/elegant-brattain-b5512a`

Branch: `claude/elegant-brattain-b5512a`
