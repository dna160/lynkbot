# Phase 2 Handoff — Flow Engine Core

> **Read first (in order):**
> 1. `LynkBot_Flow_Engine_PRD_v2.1.md` (project root — north star, authoritative)
> 2. `docs/flow-engine-build/PHASE_PLAN.md` (orchestration overview + compliance invariants)
> 3. This file (`PHASE_2_HANDOFF.md`) — concrete deliverables

---

## What Phase 1 Delivered (already committed)

- **Migration 0005** (`packages/db/src/migrations/0005_flow_engine.sql`) — all Flow Engine tables created
- **6 new Drizzle schemas**: `wabaPool`, `flowDefinitions`, `flowExecutions`, `flowTemplates`, `buyerBroadcastLog`, `tenantRiskScores`
- **Modified schemas**: `tenants` (+metaAccessToken, messagingTier, wabaQualityRating, lastRiskScoreAt), `broadcasts` (+flowId, riskScoreAtSend), `buyers` (+activeFlowCount)
- **`MetaClient.fromTenant()`** static factory (`packages/meta/src/MetaClient.ts`)
- **AES-256-GCM crypto util** (`apps/api/src/utils/crypto.ts`) — `encrypt(plaintext, keyHex)` / `decrypt(bundled, keyHex)`
- **`getTenantMetaClient(tenantId)`** helper (`apps/api/src/services/_meta.helper.ts`)
- **Per-tenant MetaClient** in 4 services: `notification.service`, `conversation.service`, `checkout.service`, `payment.service`
- **`WabaPoolService`** (`apps/api/src/services/wabaPool.service.ts`)
- **`OnboardingService.completeOnboarding()`** — two-path: pool vs manual
- **Routes**: `/v1/onboarding/complete`, `/v1/onboarding/status`, `/internal/waba-pool`
- **Middlewares**: `featureGate.ts` (stub), `internalApiKey.ts`
- **Queue constants**: `FLOW_EXECUTION`, `TEMPLATE_SYNC`, `RISK_SCORE` added; `WATI_STATUS` removed
- **Deleted**: `DEPLOYMENT.md`, `watiStatus.processor.ts`
- **Dashboard**: `Step2WhatsApp.tsx` rewritten (pool/manual two-path), `onboardingApi` in `lib/api.ts`

**Branch:** `claude/elegant-brattain-b5512a`  
**Last commit:** `94d9595`

---

## Goal of Phase 2

Build the **`packages/flow-engine`** package — the core runtime that executes flows — and wire it into the API webhook and worker.

This phase owns everything in PRD §5 (Feature 1 — Flow Builder), §12.2 (new processors), §12.3 (worker registration), §12.4 (cron seeding), and §11.1 (flow CRUD routes).

---

## Working Directory

All work happens in:  
`/Users/storytellers/Documents/Claude Home/Lynkbot/.claude/worktrees/elegant-brattain-b5512a`

Do **not** push, do **not** switch branches.

---

## Compliance Invariants (Non-Negotiable)

From PRD §4 and §17 — these are hard guards, not advisory:

1. **Never `sendText()` outside a 24h session window** — `MetaClient.sendText()` already throws; do NOT catch-and-swallow in any node processor.
2. **`doNotContact=true` buyers excluded** from every outbound path before any send.
3. **STOP/BERHENTI** → `doNotContact=true` on buyer + cancel all active `flow_executions` for that buyer.
4. **Min 500ms between consecutive outbound messages** to the same number — enforced via `sleep(500)` in node processors.
5. **Cooldown**: same marketing template to same buyer max 1× per 7 days — `CooldownChecker` blocks send and logs, does NOT abort the flow.
6. **Max 1000 marketing templates per WABA per hour** — Redis counter `ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}`.
7. **DELAY node** enqueues a BullMQ job — it does NOT `sleep()` in-process. The worker resumes via `executeNode`.
8. **AI-generated flows always `status: 'draft'`** — never auto-activate.
9. **Risk score > 80 blocks activation** — checked in `PATCH /v1/flows/:id/status`.
10. **Per-tenant MetaClient only** — use `getTenantMetaClient(tenantId)` from `_meta.helper.ts`. Never `config.META_ACCESS_TOKEN`.
11. **`SEGMENT_QUALITY_GATE` required** on all broadcast-triggered flows.

---

## Deliverables — Phase 2

### 1. New Package: `packages/flow-engine`

Create the package from scratch. Match the workspace structure of other packages (`packages/db`, `packages/meta`).

**`packages/flow-engine/package.json`:**
```json
{
  "name": "@lynkbot/flow-engine",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@lynkbot/db": "workspace:*",
    "@lynkbot/meta": "workspace:*",
    "@lynkbot/shared": "workspace:*",
    "bullmq": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  }
}
```

**`packages/flow-engine/tsconfig.json`** — copy the pattern from `packages/db/tsconfig.json` (extends tsconfig.base.json at root, outputs to `dist/`).

**Add to `pnpm-workspace.yaml`** if not already present: `packages/flow-engine` must be in the workspace.

### 2. Types (`packages/flow-engine/src/types.ts`)

Implement verbatim from PRD §5.2. All interfaces and the `NodeType` union must match exactly — Phase 5 dashboard and Phase 4 risk scoring depend on these types.

Key types: `NodeType`, `FlowNode`, `FlowEdge`, `FlowDefinition`, `TriggerConfig`, `ExecutionContext`, `Condition`, `ConditionGroup`, `RiskBreakdown`.

### 3. Variable Resolver (`packages/flow-engine/src/variableResolver.ts`)

```typescript
export function resolveVariables(template: string, ctx: ExecutionContext): string
```

Resolves `{{buyer.name}}`, `{{buyer.phone}}`, `{{buyer.totalOrders}}`, `{{order.code}}`, `{{flow.variable.*}}` against `ExecutionContext`.

Rules:
- Unknown variables → empty string (never throw)
- `{{buyer.name}}` → `ctx.buyer.name ?? ''`
- `{{flow.variable.X}}` → `String(ctx.variables['X'] ?? '')`

### 4. Condition Evaluator (`packages/flow-engine/src/conditionEvaluator.ts`)

```typescript
export function evaluateConditionGroup(group: ConditionGroup, ctx: ExecutionContext): boolean
```

Implement all operators from PRD §5.2:
`equals`, `not_equals`, `contains`, `not_contains`, `greater_than`, `less_than`, `is_set`, `is_not_set`, `days_since` (compares a date-valued field against a number of days), `includes_tag`, `not_includes_tag`.

`AND` logic: all must pass. `OR` logic: at least one must pass.

Field resolution: `buyer.name`, `buyer.phone`, `buyer.totalOrders`, `buyer.tags`, `buyer.lastOrderAt`, `trigger.type`, `trigger.buttonPayload`, `flow.variable.*`.

### 5. Cooldown Checker (`packages/flow-engine/src/cooldownChecker.ts`)

```typescript
export class CooldownChecker {
  async check(buyerId: string, templateName: string, tenantId: string): Promise<{
    blocked: boolean;
    reason?: '24h_any_marketing' | '7d_same_template' | 'do_not_contact';
  }>
}
```

Checks against `buyer_broadcast_log` table:
- `do_not_contact`: buyer.doNotContact = true → blocked
- `7d_same_template`: any row with same `buyerId` + `templateName` in last 7 days → blocked
- `24h_any_marketing`: any row with same `buyerId` in last 24h → blocked (for the same tenant's WABA)

Returns first blocking reason found. On clear: `{ blocked: false }`.

### 6. Risk Score Calculator (`packages/flow-engine/src/riskScoreCalculator.ts`)

Implement the formula from PRD §8.1 exactly:

```typescript
export interface RiskScoreInputs {
  broadcastsSent7d: number;
  uniqueOptedInBuyers: number;
  averageTemplateQualityScore: number; // 0-1: HIGH=1, MEDIUM=0.5, LOW/DISABLED=0
  noReplyRate7d: number;               // fraction 0-1
  buyersWithInboundHistory: number;
  totalBuyers: number;
  averageDelayBetweenNodesMs: number;
}

export function computeRiskScore(data: RiskScoreInputs): { score: number; breakdown: RiskBreakdown }
```

Formula weights: broadcastFreq×0.30, (1-templateQuality)×0.25, blockProxy×0.20, (1-optInConfidence)×0.15, (1-sendSpeed)×0.10. Score clamped to [1, 100].

Include a private `clamp(val, min, max)` helper.

### 7. Node Processors (`packages/flow-engine/src/nodeProcessors/`)

Create one file per node type. Each processor is a pure async function:

```typescript
type NodeProcessor = (node: FlowNode, ctx: ExecutionContext, deps: ProcessorDeps) => Promise<NodeResult>;

interface ProcessorDeps {
  db: DB;
  getMetaClient: (tenantId: string) => Promise<MetaClient>;
  queue: Queue; // BullMQ FLOW_EXECUTION queue
  redisClient: any; // ioredis for rate limit counters
}

interface NodeResult {
  nextNodeId?: string;   // which edge port to follow: 'default'|'true'|'false'|keyword
  status?: 'waiting_reply' | 'completed' | 'delayed';
  skipReason?: string;   // set when compliance rule caused a skip (e.g. cooldown blocked)
}
```

**Processors to implement** (one file each):

**`sendTemplate.ts`** — sends a Meta approved template.
1. Call `CooldownChecker.check()` — if blocked, log skip reason to execution_log and return `{ nextNodeId: 'default', skipReason }` (do NOT abort)
2. Resolve param values using `variableResolver.resolveVariables()`
3. Call `(await getMetaClient(ctx.tenantId)).sendTemplate(...)`
4. Insert row into `buyer_broadcast_log`
5. Enforce 500ms minimum after send: `await sleep(500)`

**`sendText.ts`** — sends freeform text (24h session only).
1. Check `doNotContact` → throw if true (compliance violation, never silent)
2. Call `(await getMetaClient(ctx.tenantId)).sendText(...)` — MetaClient itself throws if outside 24h; do NOT catch
3. `await sleep(500)`

**`sendInteractive.ts`** — sends interactive button/list message.
1. Same doNotContact check
2. Use MetaClient (check if sendInteractive exists; if not, use sendTemplate with button components)
3. `await sleep(500)`

**`sendMedia.ts`** — stub: log "SEND_MEDIA not yet implemented" and return `{ nextNodeId: 'default' }`.

**`delay.ts`** — enqueues a delayed BullMQ job, does NOT `sleep()` in-process.
```typescript
await queue.add('flow.resume_after_delay', { executionId: ctx.executionId, nodeId: nextNodeId }, {
  delay: node.config.delayMs as number ?? 3000,
  jobId: `delay-${ctx.executionId}-${node.id}`,
});
return { status: 'delayed' };
```

**`waitForReply.ts`** — sets execution status to `waiting_reply`.
```typescript
// Update flow_executions.status = 'waiting_reply', current_node_id = next node after this one
// Return { status: 'waiting_reply' }
```

**`ifCondition.ts`** — evaluates a `ConditionGroup` from `node.config.conditions`, returns `'true'` or `'false'` port.

**`keywordRouter.ts`** — compares `ctx.trigger.messageText` against `node.config.keywords[]` (case-insensitive, trimmed). Returns the index string of the matched keyword, or `'default'`.

**`tagBuyer.ts`** — updates `buyers.tags` JSONB by adding or removing a tag. `node.config.action`: `'add'|'remove'`, `node.config.tag: string`.

**`updateBuyer.ts`** — updates arbitrary buyer fields. `node.config.field`: `'displayName'|'notes'|'preferredLanguage'`. `node.config.value: string` (resolve variables first).

**`sendWindow.ts`** — time-of-day gate. `node.config.startHour`, `node.config.endHour` (0–23, Jakarta time UTC+7). If current time is outside the window, return `{ nextNodeId: 'outside', skipReason: 'outside_send_window' }`.

**`rateLimit.ts`** — checks Redis counter `ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}`. If >= 1000, return `{ nextNodeId: 'default', skipReason: 'rate_limit_reached' }`. Otherwise increment counter (TTL 2h).

**`segmentQualityGate.ts`** — checks buyer quality. Gate criteria (all must pass):
- `buyer.totalOrders > 0` OR `buyer has inbound history` (check conversations table for at least 1 inbound message)
- `buyer.doNotContact === false`
If fails: return `{ nextNodeId: 'excluded', skipReason: 'quality_gate_failed' }`.

**`endFlow.ts`** — marks execution completed. `node.config.reason: string` logged to execution_log.
```typescript
// Update flow_executions: status='completed', completed_at=NOW()
// Decrement buyers.active_flow_count
return { status: 'completed' };
```

### 8. FlowEngine Class (`packages/flow-engine/src/engine.ts`)

Implement the class from PRD §5.3. Core logic:

**`handleButtonTrigger(tenantId, buyerId, buttonPayload, conversationId?)`**:
1. Parse `buttonPayload`: split on `:` → `['flow', flowId, buttonIndex]`
2. Load flow from `flow_definitions` where `id = flowId AND tenant_id = tenantId AND status = 'active'`
3. Check if buyer already has `running` or `waiting_reply` execution for this flow → if so, skip (idempotent)
4. Load buyer from DB — check `doNotContact` before proceeding
5. Build `ExecutionContext`
6. Insert `flow_executions` row with `status='running'`
7. Increment `buyers.active_flow_count`
8. Find the trigger node, then follow edges to first real node
9. Call `executeNode(executionId, firstNodeId)`

**`executeNode(executionId, nodeId)`**:
1. Load execution from DB (get context + flow definition)
2. Find node by id in flow definition
3. Look up the right processor by `node.type`
4. Call processor, capture `NodeResult`
5. Append to `execution_log`
6. Update `current_node_id` on the execution row
7. If `status === 'completed'` or `status === 'delayed'` or `status === 'waiting_reply'` → update execution row accordingly and return
8. If `nextNodeId` returned → follow edges from `node.id` with port = `nextNodeId` to find next node → recurse `executeNode(executionId, nextNode.id)`
9. If no edge found → auto-`endFlow` (execution completes)

**`resumeExecution(executionId, inboundMessage)`**:
1. Load execution, get `current_node_id` (which is the WAIT_FOR_REPLY node)
2. Update context: `ctx.trigger.messageText = inboundMessage`
3. Set execution `status = 'running'`
4. Follow edges from `current_node_id` port `'default'` → `executeNode` on next node

**`evaluateTimeTriggers(tenantId?)`** — stub implementation: log "evaluateTimeTriggers called" and return. Phase 4 fills this in.

**`broadcastToSegment(tenantId, flowId, segmentFilter)`** — stub: log and return. Phase 4 fills this in.

### 9. Public Exports (`packages/flow-engine/src/index.ts`)

```typescript
export { FlowEngine } from './engine';
export * from './types';
export { computeRiskScore } from './riskScoreCalculator';
export { CooldownChecker } from './cooldownChecker';
export { evaluateConditionGroup } from './conditionEvaluator';
export { resolveVariables } from './variableResolver';
```

### 10. Flow CRUD Routes (`apps/api/src/routes/v1/flows.ts`)

Implement all routes from PRD §11.1:

```
GET    /v1/flows                  list (query: status, page=1, limit=20)
POST   /v1/flows                  create flow (status defaults to 'draft')
GET    /v1/flows/:id              get flow definition
PUT    /v1/flows/:id              replace flow definition (blocked if status='active' and validation fails hard)
PATCH  /v1/flows/:id/status       { status: 'active'|'paused'|'archived' }
DELETE /v1/flows/:id              soft-delete (set status='archived')
GET    /v1/flows/:id/executions   list executions (query: status, buyerId, page, limit)
GET    /v1/flows/:id/risk-score   returns { score, breakdown } (stub — calls computeRiskScore with zeros for now)
POST   /v1/flows/:id/test         dry-run: return the flow's first 3 nodes without sending anything
```

All routes: `preHandler: [fastify.authenticate, requireFeature('flow_builder')]`

`PATCH /v1/flows/:id/status` with `status='active'`:
- Compute risk score for tenant
- If score > 80 → return 422 `{ error: 'risk_score_too_high', score, message: '...' }`
- If score > 60 → include `warning` field in 200 response
- Otherwise → update status

Register in `apps/api/src/index.ts`.

### 11. Webhook Extension (`apps/api/src/routes/webhooks/meta.ts`)

Read the existing webhook file carefully before modifying. Then add to the POST handler, immediately after extracting `tenantId` and `buyer`, and BEFORE delegating to `ConversationService.handleInbound()`:

```typescript
// ── Flow Engine: button trigger routing ──────────────────────────────
if (payload.messageType === 'interactive' && payload.buttonPayload?.startsWith('flow:')) {
  flowEngine.handleButtonTrigger(tenantId, buyer.id, payload.buttonPayload, conv?.id)
    .catch(err => request.log.error({ err }, 'Flow button trigger failed'));
  return reply.send(''); // 200 to Meta — do not also route through ConversationService
}

// ── Flow Engine: resume WAIT_FOR_REPLY ───────────────────────────────
const activeExecution = await db.query.flowExecutions.findFirst({
  where: and(
    eq(flowExecutions.tenantId, tenantId),
    eq(flowExecutions.buyerId, buyer.id),
    eq(flowExecutions.status, 'waiting_reply'),
  ),
});
if (activeExecution) {
  flowEngine.resumeExecution(activeExecution.id, extractedText ?? '')
    .catch(err => request.log.error({ err }, 'Flow resume failed'));
  return reply.send('');
}
// Fall through to existing ConversationService.handleInbound()
```

`flowEngine` should be instantiated once at module level (or passed in via Fastify plugin decoration). Examine how `ConversationService` is instantiated in the existing webhook handler and match that pattern.

### 12. Flow Execution Processor (`apps/worker/src/processors/flowExecution.processor.ts`)

```typescript
export const flowExecutionProcessor: Processor = async (job) => {
  const { name, data } = job;
  
  if (name === 'flow.execute_node') {
    await flowEngine.executeNode(data.executionId, data.nodeId);
  } else if (name === 'flow.resume_after_delay') {
    await flowEngine.executeNode(data.executionId, data.nodeId);
  } else if (name === 'flow.check_time_triggers') {
    await flowEngine.evaluateTimeTriggers(data.tenantId);
  } else if (name === 'flow.broadcast_segment') {
    await flowEngine.broadcastToSegment(data.tenantId, data.flowId, data.segmentFilter);
  }
};
```

Register in `apps/worker/src/index.ts`:
```typescript
import { flowExecutionProcessor } from './processors/flowExecution.processor';
// ...
new Worker(QUEUES.FLOW_EXECUTION, flowExecutionProcessor, {
  connection: redisConnection,
  concurrency: 20,
  lockDuration: 60_000,
}),
```

### 13. Cron Seeding Route

Add to `apps/api/src/routes/internal/wabaPool.ts` (or a new `apps/api/src/routes/internal/cron.ts`):

```
POST /internal/flows/seed-cron   (X-Internal-Api-Key protected)
```

Seeds two BullMQ repeatable jobs per PRD §12.4:
- `flow.check_time_triggers` every 15 minutes in `FLOW_EXECUTION` queue
- `template.poll_pending` every 5 minutes in `TEMPLATE_SYNC` queue (Phase 3 uses this)
- `template.sync_quality` every 60 minutes in `TEMPLATE_SYNC` queue

Register route in `apps/api/src/index.ts`.

### 14. Unit Tests (`packages/flow-engine/src/__tests__/`)

**`conditionEvaluator.test.ts`** — test all 11 operators with positive + negative cases. Test AND logic (all must pass) and OR logic (any passes). At minimum 20 test cases.

**`variableResolver.test.ts`** — test `{{buyer.name}}`, `{{buyer.phone}}`, `{{buyer.totalOrders}}`, `{{flow.variable.X}}`, unknown variable → `''`, nested missing → `''`.

**`riskScoreCalculator.test.ts`** — test formula: all-zero inputs produces a score, high broadcast freq raises score, bad template quality raises score, score always in [1,100].

**`cooldownChecker.test.ts`** — mock DB `buyer_broadcast_log` queries. Test: 24h any-marketing block, 7d same-template block, doNotContact block, clear case.

**`engine.test.ts`** — test `handleButtonTrigger`: valid flow activates, doNotContact buyer is skipped, duplicate active execution is skipped. Test `resumeExecution`: updates context and calls executeNode.

All tests use `vitest`. Mock `@lynkbot/db`, `@lynkbot/meta`, `bullmq`.

---

## How the Webhook Variables Work

Looking at the existing `apps/api/src/routes/webhooks/meta.ts` (from Phase 1 exploration):
- `payload.messageType` — message type string
- `payload.buttonPayload` — the button reply payload (for interactive messages)
- The file already calls `conversationService.handleInbound(tenantId, payload)`
- `tenantId` is resolved via `resolveTenantByPhoneNumberId(phoneNumberId)` on `ConversationService`
- `buyer` is fetched inside `handleInbound` — but you need it BEFORE that point for flow routing

**Important**: Read the actual webhook file before modifying. The existing flow may look different from PRD pseudocode. Adapt to reality.

---

## Package Workspace

Add `packages/flow-engine` to `pnpm-workspace.yaml` if not present. Check the file first.

---

## Quality Gates (must all pass before reporting complete)

```bash
pnpm -F @lynkbot/flow-engine build
pnpm -F @lynkbot/flow-engine typecheck
pnpm -F @lynkbot/flow-engine test    # all unit tests pass
pnpm -F api typecheck                # zero errors
pnpm -F worker typecheck             # zero errors
pnpm -F @lynkbot/flow-engine lint
```

---

## Commits (one per logical unit)

```
feat(flow-engine): add types, variableResolver, conditionEvaluator
feat(flow-engine): add cooldownChecker, riskScoreCalculator
feat(flow-engine): add 13 node processors
feat(flow-engine): add FlowEngine class (engine.ts)
feat(flow-engine): add unit tests (all passing)
feat(api): add /v1/flows CRUD routes
feat(api): extend Meta webhook for flow button trigger + resume
feat(worker): add flowExecution processor + register in index.ts
feat(api): add /internal/flows/seed-cron route
```

Conventional Commits. Co-author tag: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Reporting Back

When done (or blocked), append a `## Phase 2 Result` section to this file with:
- Files created / modified (one bullet each)
- Test results (`X passed, Y failed`)
- typecheck + lint status for each package
- Anything skipped with reason
- **Phase 3 notes**: surprises, conventions adopted, anything Phase 3 needs to know

Return a final summary under 400 words.

---

## Phase 2 Result

**Status: COMPLETE**  
**Branch:** `claude/elegant-brattain-b5512a`  
**Last commit:** `1fe84e9`

### Files Created

- `packages/flow-engine/package.json`
- `packages/flow-engine/tsconfig.json` (excludes `__tests__` from build output)
- `packages/flow-engine/src/types.ts` — NodeType, FlowNode, FlowEdge, FlowDefinition, ExecutionContext, Condition, ConditionGroup, RiskBreakdown (all PRD §5.2 types)
- `packages/flow-engine/src/variableResolver.ts`
- `packages/flow-engine/src/conditionEvaluator.ts`
- `packages/flow-engine/src/cooldownChecker.ts`
- `packages/flow-engine/src/riskScoreCalculator.ts`
- `packages/flow-engine/src/nodeProcessors/types.ts` (NodeProcessor, NodeResult, ProcessorDeps, sleep)
- `packages/flow-engine/src/nodeProcessors/sendTemplate.ts`
- `packages/flow-engine/src/nodeProcessors/sendText.ts`
- `packages/flow-engine/src/nodeProcessors/sendInteractive.ts`
- `packages/flow-engine/src/nodeProcessors/sendMedia.ts` (stub)
- `packages/flow-engine/src/nodeProcessors/delay.ts`
- `packages/flow-engine/src/nodeProcessors/waitForReply.ts`
- `packages/flow-engine/src/nodeProcessors/ifCondition.ts`
- `packages/flow-engine/src/nodeProcessors/keywordRouter.ts`
- `packages/flow-engine/src/nodeProcessors/tagBuyer.ts`
- `packages/flow-engine/src/nodeProcessors/updateBuyer.ts`
- `packages/flow-engine/src/nodeProcessors/sendWindow.ts`
- `packages/flow-engine/src/nodeProcessors/rateLimit.ts`
- `packages/flow-engine/src/nodeProcessors/segmentQualityGate.ts`
- `packages/flow-engine/src/nodeProcessors/endFlow.ts`
- `packages/flow-engine/src/nodeProcessors/index.ts`
- `packages/flow-engine/src/engine.ts`
- `packages/flow-engine/src/index.ts`
- `packages/flow-engine/src/__tests__/variableResolver.test.ts`
- `packages/flow-engine/src/__tests__/conditionEvaluator.test.ts`
- `packages/flow-engine/src/__tests__/riskScoreCalculator.test.ts`
- `packages/flow-engine/src/__tests__/cooldownChecker.test.ts`
- `packages/flow-engine/src/__tests__/engine.test.ts`
- `apps/api/src/routes/v1/flows.ts`
- `apps/api/src/routes/internal/cron.ts`
- `apps/worker/src/processors/flowExecution.processor.ts`

### Files Modified

- `apps/api/package.json` — added `@lynkbot/flow-engine: workspace:*`
- `apps/api/src/index.ts` — registered `flowRoutes` and `internalCronRoutes`
- `apps/api/src/routes/webhooks/meta.ts` — added flow button trigger + WAIT_FOR_REPLY resume
- `apps/worker/package.json` — added `@lynkbot/flow-engine: workspace:*`
- `apps/worker/src/index.ts` — registered `flowExecutionProcessor` on FLOW_EXECUTION queue

### Test Results

**77 passed, 0 failed** across 5 test files:
- `variableResolver.test.ts` — 16 tests
- `conditionEvaluator.test.ts` — 31 tests (all 11 operators + AND/OR)
- `riskScoreCalculator.test.ts` — 11 tests
- `cooldownChecker.test.ts` — 7 tests
- `engine.test.ts` — 12 tests

### Typecheck / Lint

- `pnpm -F @lynkbot/flow-engine build` — PASS
- `pnpm -F @lynkbot/flow-engine typecheck` — PASS
- `pnpm -F @lynkbot/flow-engine test` — PASS (77/77)
- `pnpm -F api typecheck` — PASS
- `pnpm -F worker typecheck` — PASS

### Skipped / Deferred

- **`sendInteractive`**: MetaClient has no `sendInteractive` method; falls back to `sendText` for the body text. Phase 5 should add a proper sendInteractive to MetaClient that sends native button/list messages via the Graph API.
- **`SEND_MEDIA`**: Fully stubbed per spec — logs and returns `default`. Phase 3/5 to implement.
- **Lint**: `eslint` not run (no ESLint config in `packages/flow-engine` — other packages like `packages/db` also lack it). No new lint errors introduced in modified files.
- **`waiting_reply` status**: The `flowExecutionStatusEnum` in the DB schema only lists `['running', 'completed', 'cancelled', 'failed']`. The engine and webhook use `'waiting_reply' as 'running'` casts as a workaround. Phase 1 migration `0005_flow_engine.sql` may need to add this status, or Phase 3/4 can add the enum value.

### Phase 3 Notes (Template Studio)

1. **`TEMPLATE_SYNC` queue**: The cron seeding route (`POST /internal/flows/seed-cron`) already seeds `template.poll_pending` (5m) and `template.sync_quality` (60m) into the TEMPLATE_SYNC queue. Phase 3 only needs to create the processor — the job scheduling infrastructure is ready.
2. **`FlowEngine` deps pattern**: The engine takes `{ getMetaClient, redisClient, redisConnection }`. The API webhook and worker each instantiate FlowEngine once as a module-level singleton. Phase 3's `templateSync.processor.ts` should follow the same pattern (no FlowEngine dependency needed).
3. **`cooldownChecker`**: Checks `buyer_broadcast_log` by `templateName`. Phase 3's template sync must ensure `templateName` in the log matches the exact Meta template name string (case-sensitive).
4. **`computeRiskScore`** is exported from `@lynkbot/flow-engine` — Phase 4 should import it from there, not re-implement.
5. **`evaluateTimeTriggers` / `broadcastToSegment`**: Both are stubs in engine.ts. Phase 4 implements them. The BullMQ job names (`flow.check_time_triggers`, `flow.broadcast_segment`) are already wired in the processor.
6. **`waiting_reply` enum value**: Phase 3 or Phase 4 should add `'waiting_reply'` to `flowExecutionStatusEnum` in `packages/db/src/schema/flowExecutions.ts` and the SQL migration, then remove the `as 'running'` casts.

