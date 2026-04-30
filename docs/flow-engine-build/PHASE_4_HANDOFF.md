# Phase 4 Handoff — Re-engagement + Risk Scoring

> **Read first (in order):**
> 1. `LynkBot_Flow_Engine_PRD_v2.1.md` (project root — north star, authoritative)
> 2. `docs/flow-engine-build/PHASE_PLAN.md` (orchestration overview + compliance invariants)
> 3. `docs/flow-engine-build/PHASE_3_HANDOFF.md` (Phase 3 result — what's already built)
> 4. This file (`PHASE_4_HANDOFF.md`) — concrete Phase 4 deliverables

---

## What Phases 1–3 Delivered (all committed on `claude/elegant-brattain-b5512a`)

### Phase 1
- 6 new Drizzle schema files + migration `0005_flow_engine.sql`
- Per-tenant MetaClient pattern, WABA pool table + service
- AES-256-GCM crypto util, `featureGate` middleware

### Phase 2
- `packages/flow-engine` — 77 unit tests passing
- `FlowEngine` class with `handleButtonTrigger`, `executeNode`, `resumeExecution`
- Flow Builder CRUD routes (`/v1/flows`)
- `flowExecution.processor.ts` in worker
- `/internal/flows/seed-cron` route

### Phase 3
- `TemplateStudioService` (CRUD, Meta submit v23.0, appeal enforcement, status handling)
- `/v1/flow-templates` (8 endpoints) with all PRD compliance guards
- `templateSync.processor.ts` in worker
- Template list + editor dashboard pages
- 28/28 integration tests passing

### Phase 4 (just completed)
- `riskScore.service.ts` — `getForTenant` (1h cache), `computeAndStore` (live DB), `handleQualityUpdate`
- `/v1/risk-score` (GET + POST /compute) — real DB computation, level field (ok|warning|blocked)
- `flows.ts` PATCH status + GET risk-score — wired to real `RiskScoreService` (replaced stubs)
- `meta.ts` webhook — `message_template_status_update` + `phone_number_quality_update` handlers
- `riskScore.processor.ts` — `risk.compute` job (single-tenant or all-tenants sweep)
- `worker/index.ts` — RISK_SCORE worker registered (concurrency=3)
- `FlowEngine.evaluateTimeTriggers` — real implementation (scans active time_based flows → broadcastToSegment)
- `FlowEngine.broadcastToSegment` — real implementation (segment filter, doNotContact guard, 1000/hr Redis cap, enqueue jobs)
- `RedisClientLike` — added `incrby` + `set` methods

**Last commit:** `c8a26e8` on branch `claude/elegant-brattain-b5512a`

---

## Goal of Phase 5

Build the **AI Flow Generation + Dashboard UI**:
- `/v1/ai/generate-flow` and `/v1/ai/modify-flow` API routes
- Drawflow canvas for visual flow editing (`FlowEditorPage`)
- `FlowsListPage` dashboard page
- `RiskScoreGauge` component
- Sidebar + routing updates
- API client extensions (`flowsApi`, `riskScoreApi`, `aiApi`)

Owns: PRD §9 (Feature 5), §11.3 (AI routes), §13.1–13.3 (dashboard UI).

---

## Working Directory

`/Users/storytellers/Documents/Claude Home/Lynkbot/.claude/worktrees/elegant-brattain-b5512a`

Do **not** push. Do **not** switch branches.

---

## Phase 5 Deliverables

### 1. AI Flow Generation Routes (`apps/api/src/routes/v1/ai.ts`)

Extend the existing `/v1/ai/chat` file. Add two new routes:

**`POST /v1/ai/generate-flow`**
```typescript
// Request
{ prompt: string; productId?: string; audienceSegment?: string }

// Response
{
  flowDefinition: FlowDefinition;
  missingTemplates: Array<{ nodeId: string; suggestedName: string; suggestedBody: string }>;
  warnings: string[];
  riskScoreEstimate: number;
  parseError?: string;
}
```

Implementation:
1. Fetch tenant's approved templates (`db.query.flowTemplates.findMany`) to inject into prompt
2. Fetch distinct tags from buyers (`db.query.buyers`) for context
3. Build system prompt from `FLOW_GENERATION_SYSTEM_PROMPT` (PRD §9.1) with schema + templates + tags injected
4. Call `getLLMClient()` (existing pattern from `apps/api/src/services/ai.ts`) with the prompt
5. Parse response JSON leniently — if parse fails, set `parseError`, return best-effort partial
6. Compute `riskScoreEstimate` using `computeRiskScore` with stub 0-data (AI-generated flows start as draft, never auto-activate)
7. Identify nodes with `config.templatePlaceholder=true` → populate `missingTemplates[]`
8. Return response (do NOT save to DB — frontend calls `POST /v1/flows` to save)

**`POST /v1/ai/modify-flow`**
```typescript
// Request
{ flowId: string; instruction: string }

// Response (same shape as generate-flow)
```

1. Load existing flow from DB
2. Inject current flow JSON into prompt
3. Call LLM, parse leniently
4. Return modified `FlowDefinition` (do NOT save — frontend calls `PUT /v1/flows/:id`)

**`FLOW_GENERATION_SYSTEM_PROMPT`** — create `packages/flow-engine/src/prompts/flowGeneration.ts`:
```typescript
export const FLOW_GENERATION_SYSTEM_PROMPT = `...` // From PRD §9.1
export const FLOW_SCHEMA_JSON = JSON.stringify(/* FlowDefinition schema */);
```

### 2. FlowsListPage (`apps/dashboard/src/pages/Flows/FlowsListPage.tsx`)

- Table: Name, Status badge (draft=slate, active=green, archived=red), Trigger Type, Created At, Actions
- Actions: Edit (draft/paused), Activate (draft→active), Pause (active→paused), Archive, Test
- Uses `flowsApi.list()` from `lib/api.ts`
- Risk score banner at top: `<RiskScoreGauge>` (shows score + level)
- Empty state: "No flows yet — Generate with AI or build manually"

### 3. FlowEditorPage (`apps/dashboard/src/pages/Flows/FlowEditorPage.tsx`)

- Uses **Drawflow** (`drawflow@0.0.60` — pin this in `apps/dashboard/package.json`)
- Left sidebar: node palette (drag to add node types: SEND_TEMPLATE, SEND_TEXT, DELAY, etc.)
- Canvas: Drawflow instance renders nodes and edges; exports as `FlowDefinition` JSON
- Right sidebar: node config editor (click node → edit its config in a panel)
- Bottom bar: flow name, status, trigger type selector
- AI panel: text field + "Generate" button → calls `POST /v1/ai/generate-flow` → loads result into canvas
- Save button: calls `POST /v1/flows` (create) or `PUT /v1/flows/:id` (update)
- Nodes with `validationErrors[]` shown with red border

**Drawflow integration pattern:**
```tsx
import Drawflow from 'drawflow';
import 'drawflow/src/drawflow.css';

const editor = new Drawflow(containerRef.current);
editor.start();
// Use editor.addNode(), editor.export(), editor.import() 
```

### 4. RiskScoreGauge (`apps/dashboard/src/components/RiskScoreGauge.tsx`)

```tsx
// Props: score (number 1-100), level ('ok'|'warning'|'blocked')
// Renders: colored arc gauge (green/yellow/red) + numeric score
// ok (<60): green, warning (60-80): yellow, blocked (>80): red
// Fetches from GET /api/v1/risk-score on mount
```

### 5. Dashboard Routes + Sidebar Updates

**`apps/dashboard/src/App.tsx`** — add:
```tsx
<Route path="/dashboard/flows" element={<FlowsListPage />} />
<Route path="/dashboard/flows/new" element={<FlowEditorPage />} />
<Route path="/dashboard/flows/:id/edit" element={<FlowEditorPage />} />
```

**`apps/dashboard/src/components/Sidebar.tsx`** — add Flows entry:
```tsx
{ to: '/dashboard/flows', label: 'Flows', icon: <FlowIcon /> }
```

### 6. API Client Extensions (`apps/dashboard/src/lib/api.ts`)

Add:
```typescript
export const flowsApi = {
  list: (params?: { status?: string; page?: number; limit?: number }) => api.get('/flows', { params }),
  get: (id: string) => api.get(`/flows/${id}`),
  create: (data: CreateFlowPayload) => api.post('/flows', data),
  update: (id: string, data: Partial<CreateFlowPayload>) => api.put(`/flows/${id}`, data),
  updateStatus: (id: string, status: string) => api.patch(`/flows/${id}/status`, { status }),
  delete: (id: string) => api.delete(`/flows/${id}`),
  getExecutions: (id: string, params?: { status?: string; buyerId?: string }) =>
    api.get(`/flows/${id}/executions`, { params }),
  test: (id: string) => api.post(`/flows/${id}/test`),
};

export const riskScoreApi = {
  get: () => api.get('/risk-score'),
  compute: () => api.post('/risk-score/compute'),
};

export const aiApi = {
  generateFlow: (data: { prompt: string; productId?: string; audienceSegment?: string }) =>
    api.post('/ai/generate-flow', data),
  modifyFlow: (data: { flowId: string; instruction: string }) =>
    api.post('/ai/modify-flow', data),
};
```

---

## Known Constraints / Gotchas

1. **`getLLMClient()`**: Check `apps/api/src/services/ai.ts` for the existing pattern. It uses Grok (xAI) via `GROK_API_KEY` env var. Do NOT import `@anthropic-ai/sdk` here.

2. **Drawflow CSS**: Must import `drawflow/src/drawflow.css` in `FlowEditorPage.tsx` or in the dashboard's global CSS. Without it, the canvas renders blank.

3. **Drawflow version**: Pin `"drawflow": "0.0.60"` in `apps/dashboard/package.json`. Run `pnpm install` after modifying.

4. **`computeRiskScore` import in AI route**: Import from `@lynkbot/flow-engine`, same as in `flows.ts`.

5. **Pre-existing typecheck errors**: `@lynkbot/ai`, `@lynkbot/pantheon`, `@lynkbot/payments` packages are not built in Docker. Errors in `ai.ts`, `intelligence.ts`, `conversation.service.ts`, `payment.service.ts` are pre-existing — do NOT fix them in Phase 5.

6. **AI routes** extend the existing `apps/api/src/routes/v1/ai.ts` file. Read it first — it already has `POST /v1/ai/chat`. Add the two new routes to the same plugin.

---

## Quality Gates

All must pass in Docker (`lynkbot-test:phase5`):

```bash
pnpm -F @lynkbot/flow-engine build  # should already pass; rebuild after prompts file added
pnpm -F api typecheck               # zero errors in Phase 5 files
pnpm -F worker typecheck            # unchanged from Phase 4
pnpm -F api test                    # 28/28 still passing
```

Dashboard typecheck is optional if `tsconfig.json` doesn't exist for it.

---

## Commits (suggested)

```
feat(flow-engine): add FLOW_GENERATION_SYSTEM_PROMPT to prompts/flowGeneration.ts
feat(api): POST /v1/ai/generate-flow + POST /v1/ai/modify-flow routes
feat(dashboard): FlowsListPage + RiskScoreGauge
feat(dashboard): FlowEditorPage with Drawflow canvas + AI generation panel
feat(dashboard): add flowsApi, riskScoreApi, aiApi to lib/api.ts
feat(dashboard): add Flows routes + sidebar entry
```

---

## Phase 4 Result

**Status: COMPLETE** — all Phase 4 deliverables committed, 28/28 tests passing, zero TypeScript errors.

### Files Created / Modified

- **`apps/api/src/services/riskScore.service.ts`** (NEW) — RiskScoreService with live DB computation
- **`apps/api/src/routes/v1/riskScore.ts`** (NEW) — GET + POST /compute endpoints
- **`apps/api/src/index.ts`** — registered riskScoreRoutes
- **`apps/api/src/routes/v1/flows.ts`** — replaced stub computeRiskScore with real riskScoreService.getForTenant(); also fixed GET /flows/:id/risk-score
- **`apps/api/src/routes/webhooks/meta.ts`** — added message_template_status_update + phone_number_quality_update handlers
- **`apps/worker/src/processors/riskScore.processor.ts`** (NEW) — risk.compute job processor
- **`apps/worker/src/index.ts`** — registered RISK_SCORE queue (concurrency=3)
- **`packages/flow-engine/src/engine.ts`** — implemented evaluateTimeTriggers + broadcastToSegment
- **`packages/flow-engine/src/nodeProcessors/types.ts`** — added incrby + set to RedisClientLike

### Test Results

`pnpm -F api exec vitest run` (flowTemplates + crypto): **28/28 passed** in Docker (lynkbot-test:phase4)

### Typecheck Status

- `pnpm -F api typecheck`: zero errors in Phase 4 files
- `pnpm -F worker typecheck`: zero errors in Phase 4 files
- `pnpm -F @lynkbot/flow-engine build`: clean (image builds without error)

### Skipped / Notes

- `riskScoreEstimate` in broadcast route (`apps/api/src/routes/v1/broadcasts.ts`) not wired — Phase 5 can add it when broadcasts are triggered by flows
- Risk score hourly cron not seeded via `/internal/flows/seed-cron` — can be added in Phase 6 alongside existing cron seeding
