# Phase 4 Handoff — Wizard Rebuild + Order Triggers

**Branch:** `claude/dreamy-tharp-f5c467`
**Status:** Complete ✅
**Next phase:** Phase 5 — Scheduling Confirmation Rewire

---

## What Phase 4 Built

### 1. FlowEngine — `handleOrderEvent()` method

**File:** `packages/flow-engine/src/engine.ts`

New public method added before `evaluateTimeTriggers`:

```typescript
async handleOrderEvent(
  tenantId: string,
  buyerId: string,
  event: 'payment_confirmed' | 'shipped' | 'delivered' | 'payment_failed',
  orderId?: string,
): Promise<void>
```

Behaviour:
- Queries DB for active flows where `trigger_type = 'order_event'` and `tenant_id = tenantId`
- Checks each flow's trigger node config for `cfg.orderEvent ?? cfg.event` match
- Idempotency guard: skips if an execution for this `(flowId, buyerId, orderId)` combo already exists today
- Creates execution record, calls `this.executeNode` fire-and-forget (errors logged, not thrown)
- Does NOT block the calling service — callers use `.catch(console.error)`

### 2. FlowEngine Singletons

**API process:** `apps/api/src/services/flowEngine.singleton.ts`
- One `FlowEngine` instance shared across all API route handlers
- Avoids multiple Redis connections per request
- Used by: `payment.service.ts`, `meta.ts` (webhook handler)

**Worker process:** `apps/worker/src/_flowEngine.ts`
- Separate singleton — worker runs in a different process
- Used by: `paymentExpiry.processor.ts`, `tracking.processor.ts`
- The `webhookMessage` processor in worker still creates its own inline instance (not changed — different concern)

### 3. Order Event Wiring

Four call sites were wired. All use fire-and-forget (`.catch(console.error)`) to never block primary logic.

| File | Event | Trigger |
|------|-------|---------|
| `apps/api/src/services/payment.service.ts` | `payment_confirmed` | After `handlePaymentConfirmed` audit log |
| `apps/api/src/services/payment.service.ts` | `payment_failed` | After `handlePaymentExpired` order cancel |
| `apps/worker/src/processors/paymentExpiry.processor.ts` | `payment_failed` | After order status → CANCELLED |
| `apps/worker/src/processors/tracking.processor.ts` | `shipped` or `delivered` | After shipment status update |

Tracking → flow event mapping:
- `IN_TRANSIT` or `OUT_FOR_DELIVERY` → `'shipped'`
- `DELIVERED` → `'delivered'`
- `EXCEPTION`, `PENDING`, other statuses → no flow event fired

### 4. scenarioBuilders.ts — Typed Trigger Nodes + S6

**File:** `apps/dashboard/src/lib/scenarioBuilders.ts`

All scenario builders upgraded from broken legacy `TRIGGER` node type to typed node types:

| Template | Trigger Node Type | Notes |
|----------|-------------------|-------|
| S1 (Book Appointment) | `TRIGGER_INBOUND_KEYWORD` | keyword path; button_click path keeps legacy TRIGGER |
| S2 (Answer Questions) | `TRIGGER_INBOUND_KEYWORD` | |
| S3 (Collect Lead) | `TRIGGER_INBOUND_KEYWORD` | **Upgraded to COLLECT_INFO** node (see below) |
| S4 (Broadcast) | legacy `TRIGGER` + `triggerType: 'broadcast'` | Correct — broadcastToSegment uses this |
| S5 (Human Handoff) | `TRIGGER_INBOUND_KEYWORD` | |
| S6 (Order Follow-Up) | `TRIGGER_ORDER_EVENT` | New template |

**S3 COLLECT_INFO upgrade:**
Old pattern: N separate `SEND_TEXT` + `WAIT_FOR_REPLY` node pairs per question.
New pattern: single `COLLECT_INFO` node with `questions: CollectInfoQuestion[]`. The engine handles sequential collection internally. Each question gets: `id`, `promptText`, `variableName` (slug of prompt text), `type: 'text'`, `required: true`.

**S6 (Order Follow-Up) new template:**
- Trigger: `TRIGGER_ORDER_EVENT` with `{ orderEvent: data.orderEvent }`
- Main node: `SEND_TEXT` with configurable or default message per event type
- Default messages per event: payment_confirmed → "✅ Payment confirmed! Your order is being processed 🎉", shipped → "📦 Great news! Your order is on its way.", delivered → "✅ Your order has been delivered!", payment_failed → "⚠️ Your payment could not be processed."

### 5. Dashboard Type Extensions

**File:** `apps/dashboard/src/types/flow.ts`

- `TriggerType` union: added `'order_event'`
- `TriggerConfig`: added `orderEvent?: 'payment_confirmed' | 'shipped' | 'delivered' | 'payment_failed'`

**File:** `apps/dashboard/src/data/templates.ts`

- Added S6 entry: `{ id: 'S6', labelEn: 'Order Follow-Up', icon: '📦', category: 'Sales', ... }`

**File:** `apps/dashboard/src/pages/Flows/components/ScenarioForm.tsx`

- Added S6 form section: order event `<select>` + follow-up message `<textarea>`

### 6. useScenarioBuilder — API Trigger Type Derivation Fix

**File:** `apps/dashboard/src/hooks/useScenarioBuilder.ts`

`saveFlow` now derives the API `triggerType` string from the trigger node's **type**, not its config:

```
TRIGGER_INBOUND_KEYWORD → 'inbound_keyword'
TRIGGER_ORDER_EVENT     → 'order_event'
TRIGGER_TIME_SINCE_EVENT → 'time_based'
legacy TRIGGER + config.triggerType === 'broadcast' → 'time_based'
legacy TRIGGER + other → 'inbound_keyword'
```

### 7. buildFlowDefinition.ts — Pure Wizard-to-Flow Converter

**File:** `apps/dashboard/src/pages/Flows/buildFlowDefinition.ts`

Pure function, no side effects, no React, no API calls. Converts `WizardState` → `FlowDefinition`.

Exported types:
- `WizardState` — full wizard state shape
- `WizardPurpose` — `'qualify' | 'scheduling' | 'followup'`
- `WizardTriggerType` — `'inbound_keyword' | 'order_event' | 'time_since_event'`
- `OrderEventType` — `'payment_confirmed' | 'shipped' | 'delivered' | 'payment_failed'`
- `CollectInfoQuestion` — question shape for COLLECT_INFO node

Exported functions:
- `buildFlowDefinition(state: WizardState): FlowDefinition`
- `buildApiTriggerType(state: WizardState): string` — maps to API convention (`time_since_event` → `'time_based'`)

Node sequence produced:
1. Trigger node (typed: TRIGGER_INBOUND_KEYWORD / TRIGGER_ORDER_EVENT / TRIGGER_TIME_SINCE_EVENT)
2. Optional COLLECT_INFO node (if `qualifyingQuestions.enabled && questions.length > 0`)
3. Main action node:
   - `qualify` purpose → SEND_TEXT (outcome message)
   - `scheduling` purpose → START_SCHEDULING
   - `followup` purpose → SEND_TEMPLATE (if templateName set) or SEND_TEXT + optional DELAY
4. END_FLOW node

### 8. AutomationWizardPage.tsx — New 5-Step Wizard

**File:** `apps/dashboard/src/pages/Flows/AutomationWizardPage.tsx`

Replaces `ScenarioBuilderPage.tsx` + `TemplateGalleryPage.tsx`. No template ID required.

Steps:
1. **Purpose** — Radio: qualify lead / schedule appointment / send follow-up
2. **Trigger** — Keywords input (qualify/scheduling) OR order event selector (followup)
3. **Questions** — Toggle to enable; question builder (max 5); skip button to jump to step 4
4. **Action** — Purpose-specific: qualify → outcome message; scheduling → intro/type/confirmation model; followup → message text + delay in minutes
5. **Review** — Flow name input + node summary + "Save Draft" / "Activate" buttons

Submit path:
```typescript
const definition = buildFlowDefinition(state);
const triggerType = buildApiTriggerType(state);
const { data } = await flowsApi.create({ name: state.name, definition, triggerType });
if (activate) await flowsApi.updateStatus(data.id, 'active');
navigate('/dashboard/automations');
```

### 9. App.tsx Routing Update

**File:** `apps/dashboard/src/App.tsx`

- Removed: `import { ScenarioBuilderPage }` and `import { TemplateGalleryPage }`
- Removed: `automations/new/:templateId` → ScenarioBuilderPage route
- Changed: `automations/new` now renders `<AutomationWizardPage />` (was TemplateGalleryPage)
- `ScenarioBuilderPage.tsx` and `TemplateGalleryPage.tsx` files left on disk but are no longer imported or routed — safe to delete in a future cleanup PR

---

## Invariants Phase 5 Must Preserve

1. **Never use `TRIGGER` node type** in new code — it silently fails in the engine. Always use `TRIGGER_INBOUND_KEYWORD`, `TRIGGER_ORDER_EVENT`, or `TRIGGER_TIME_SINCE_EVENT`.

2. **`handleOrderEvent` is fire-and-forget** — callers must `.catch(console.error)`. It must never throw to the caller's try/catch.

3. **FlowEngine singletons are per-process** — API uses `flowEngine.singleton.ts`; worker uses `_flowEngine.ts`. They are never imported across process boundaries.

4. **S4 (Broadcast) keeps legacy TRIGGER** — `broadcastToSegment` in the engine specifically looks for `triggerType: 'broadcast'` in the legacy TRIGGER node config. Do not upgrade S4 to a typed trigger node.

5. **`buildFlowDefinition` must stay pure** — no side effects, no imports from React or API layer. Used in tests and potentially in a Node.js CLI context.

6. **`CollectInfoQuestion` shape** — must match the engine's COLLECT_INFO handler exactly: `{ id, promptText, variableName, type: 'text' | 'choice', choices?, required }`.

7. **API `triggerType` string** — the string sent to `flowsApi.create()` must be one of: `'inbound_keyword'`, `'order_event'`, `'time_based'`, `'broadcast'`. The `buildApiTriggerType` function is the single source of truth.

---

## Files Changed in Phase 4

### Modified
- `packages/flow-engine/src/engine.ts` — added `handleOrderEvent()`
- `apps/api/src/routes/webhooks/meta.ts` — use singleton instead of inline FlowEngine
- `apps/api/src/services/payment.service.ts` — fire order events on payment_confirmed/payment_failed
- `apps/worker/src/processors/paymentExpiry.processor.ts` — fire payment_failed event
- `apps/worker/src/processors/tracking.processor.ts` — fire shipped/delivered events
- `apps/dashboard/src/lib/scenarioBuilders.ts` — typed trigger nodes + S6 + COLLECT_INFO for S3
- `apps/dashboard/src/data/templates.ts` — added S6
- `apps/dashboard/src/pages/Flows/components/ScenarioForm.tsx` — added S6 form
- `apps/dashboard/src/hooks/useScenarioBuilder.ts` — fix API triggerType derivation
- `apps/dashboard/src/types/flow.ts` — added order_event TriggerType + orderEvent config field
- `apps/dashboard/src/App.tsx` — route automations/new to AutomationWizardPage

### Created
- `apps/api/src/services/flowEngine.singleton.ts`
- `apps/worker/src/_flowEngine.ts`
- `apps/dashboard/src/pages/Flows/buildFlowDefinition.ts`
- `apps/dashboard/src/pages/Flows/AutomationWizardPage.tsx`
- `docs/v3-build/PHASE_4_HANDOFF.md` (this file)

### No longer imported (safe to delete)
- `apps/dashboard/src/pages/Flows/ScenarioBuilderPage.tsx`
- `apps/dashboard/src/pages/Flows/TemplateGalleryPage.tsx`

---

## Phase 5 — Scheduling Confirmation Rewire

Per PRD §3, Phase 5 must rebuild the scheduling flow execution path:

### What Phase 5 Must Do

1. **`confirm_booking` branch rewrite** — When staff confirms, engine must:
   - Send confirmation message to buyer with date/time/service details
   - Mark appointment as `confirmed` in DB
   - Send calendar invite or at minimum a structured summary

2. **Decline path** — When staff declines a booking request:
   - Re-present available slots to buyer (not just "sorry")
   - Allow buyer to pick a new slot without restarting the flow

3. **Instant confirmation model** — When `confirmationModel === 'instant'` on START_SCHEDULING node:
   - Skip staff notification entirely
   - Auto-confirm the first available slot
   - Send confirmation directly to buyer

4. **Services dashboard UI** — `apps/dashboard/src/pages/Services/ServicesPage.tsx` needs:
   - List services with name, duration, price
   - Create/edit/delete service
   - Assign staff members to services
   - Set availability windows per service

5. **`START_SCHEDULING` node config extension** — Add `serviceId` field (currently only `assignedStaffId`). The engine must look up the service's configured staff if no `assignedStaffId` override is given.

### Entry Point for Phase 5
Start by reading `packages/flow-engine/src/engine.ts` — search for `START_SCHEDULING` and the `confirm_booking` handling. Then read `apps/api/src/routes/v1/services.ts` and the appointments DB schema.
