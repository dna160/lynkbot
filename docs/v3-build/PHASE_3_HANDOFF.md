# Phase 3 Handoff — COLLECT_INFO Engine

**Status:** Complete  
**Branch:** `claude/dreamy-tharp-f5c467`  
**PRD reference:** LynkBot v3 Core Systems PRD §2 (flow engine, new node types)

---

## What Phase 3 Did

Phase 3 built the COLLECT_INFO node end-to-end: the engine processor, the pause/resume loop, variable storage, condition evaluation, and the flow editor UI. It also updated the engine's trigger-node lookup to accept all v3 trigger types (not just legacy `TRIGGER`).

---

## Files Changed in Phase 3

### Created
- `packages/flow-engine/src/nodeProcessors/collectInfo.ts`

### Modified
- `packages/flow-engine/src/nodeProcessors/index.ts` — registered `COLLECT_INFO: collectInfoProcessor`
- `packages/flow-engine/src/engine.ts` — 4 targeted changes (see detail below)
- `packages/flow-engine/src/variableResolver.ts` — added `answers.*` namespace
- `packages/flow-engine/src/conditionEvaluator.ts` — added `answers.*` field resolution
- `apps/dashboard/src/types/flow.ts` — added `'COLLECT_INFO'` to `NodeType` union
- `apps/dashboard/src/pages/Flows/components/nodes/nodeConfig.ts` — palette entry, source handles, preview
- `apps/dashboard/src/pages/Flows/components/NodeConfigEditor.tsx` — config panel section

---

## COLLECT_INFO Processor Design

### State key conventions
- `collectInfo_<nodeId>_index` — stored in `ctx.variables`; the 1-based index of the question we're waiting on (advances after each send, so on resume it points to the just-asked question)
- `answers.<variableName>` — stored in `ctx.variables`; the collected answer for each question

### Execution flow
```
First entry (index = 0, no inbound text):
  → send questions[0].promptText
  → set index = 1
  → return { status: 'waiting_reply' }

Resume (buyer replied):
  → read index (e.g. 1), prev question = questions[0]
  → store inboundText → ctx.variables['answers.buyer_name']
  → if more questions: send questions[1], set index = 2, return waiting_reply
  → if all answered: onComplete === 'end' → { status: 'completed' }
                     onComplete === 'continue' → { nextNodeId: 'default' }
```

### Choice questions
`type === 'choice'` sends numbered options as plain text (MetaClient has no sendInteractive). The processor normalises buyer replies:
- Numeric `"1"` → `choices[0]`
- `"ci_N"` payload format → `choices[N]` (reserved for future interactive support)
- Any other text → stored verbatim

### Resume guard
`resumeExecution()` in `engine.ts` now re-enters COLLECT_INFO nodes on buyer reply (same pattern as AGENT nodes). The condition:
```typescript
if (currentNode?.type === 'AGENT' || currentNode?.type === 'COLLECT_INFO') {
  await this.executeNode(executionId, currentNodeId, ctx);
  return;
}
```

---

## Engine Trigger-Node Lookup Updated

All three `definition.nodes.find(n => n.type === 'TRIGGER')` sites were updated to:

```typescript
definition.nodes.find(n =>
  n.type === 'TRIGGER' || n.type === 'TRIGGER_INBOUND_KEYWORD' ||
  n.type === 'TRIGGER_ORDER_EVENT' || n.type === 'TRIGGER_TIME_SINCE_EVENT'
)
```

Affected:
1. `handleButtonTrigger` — finds trigger to follow first edge from
2. `handleKeywordTrigger` — keyword fallback reads config from trigger node inside definition
3. `handleKeywordTrigger` — second trigger-node lookup for finding first edge

The `'TRIGGER'` type continues to work for all flows saved before v3 migration.

---

## Variable Resolver + Condition Evaluator

Both now support `answers.*`:

**`variableResolver.ts`** — `{{answers.buyer_name}}` in SEND_TEXT message templates resolves to `ctx.variables['answers.buyer_name']`.

**`conditionEvaluator.ts`** — IF_CONDITION nodes with `field: 'answers.buyer_name'` resolve the same way. Enables branching on collected answers.

---

## Dashboard Flow Editor

- `NodeType` union in `apps/dashboard/src/types/flow.ts` includes `'COLLECT_INFO'`
- Palette entry: category `logic`, icon `📋`, label "Collect Info"
- Source handles: `['default']` — single exit after all questions answered
- Preview text: `"N questions"` or `"Add questions →"`
- Config panel: question list editor (add/remove/reorder), per-question prompt/variable/type/choices, `onComplete` toggle

---

## What Phase 4 Must Do

Phase 4 is the **Wizard Rebuild + Order Triggers** phase.

### 1. Delete/replace `ScenarioBuilderPage.tsx`

The current `ScenarioBuilderPage` generates non-functional fake flows (hardcoded `TRIGGER` with fake node types). Replace it with a real wizard that emits valid `FlowDefinition` objects using the engine's node types.

Per user decision: delete the existing page, rebuild as `AutomationWizardPage`. The route `automations/new/:templateId` in `App.tsx` already points here — just swap the component.

**Key constraint:** The wizard must call a `buildFlowDefinition(templateId, answers) → FlowDefinition` pure function (testable, no side effects). This function is the contract between the wizard UI and the engine schema.

### 2. Create `buildFlowDefinition.ts`

`apps/dashboard/src/pages/Flows/buildFlowDefinition.ts`

A pure function mapping template IDs + wizard answers → valid `FlowDefinition`. Templates to cover:
- `welcome_message` — inbound keyword → SEND_TEXT
- `collect_and_qualify` — inbound keyword → COLLECT_INFO → IF_CONDITION → two SEND_TEXT branches
- `booking_flow` — inbound keyword → SEND_TEXT (intro) → START_SCHEDULING
- `order_followup` — order_event trigger → SEND_TEXT

### 3. Add `FlowEngine.handleOrderEvent()`

`packages/flow-engine/src/engine.ts`

New public method accepting `{ tenantId, orderId, buyerId, orderEvent: OrderEvent }`. Should:
1. Find all active flows with `triggerType === 'order_event'` and matching `triggerConfig.orderEvent`
2. For each: check for already-running execution (idempotent), insert `flow_executions` row, `executeNode` from the flow's trigger → first edge

`OrderEvent` type is already defined in `packages/flow-engine/src/types.ts`:
```typescript
type OrderEvent = 'payment_confirmed' | 'shipped' | 'delivered' | 'payment_failed'
```

### 4. Wire order events into services

Call `FlowEngine.handleOrderEvent()` from:
- `apps/api/src/services/order.service.ts` — `payment_confirmed` / `payment_failed` events
- `apps/worker/src/services/paymentExpiry.processor.ts` — `payment_failed`
- `apps/worker/src/services/tracking.processor.ts` — `shipped` / `delivered`

These callers need a singleton `FlowEngine` instance. Create:
`apps/api/src/services/flowEngine.singleton.ts`

### 5. Update `TRIGGER_ORDER_EVENT` node in the wizard UI

The wizard's order followup template must set `triggerConfig.orderEvent` correctly. The existing `handleKeywordTrigger` engine path does NOT handle order events — `handleOrderEvent()` is a separate entry point.

---

## Invariants Inherited

All Phase 1 + Phase 2 invariants apply. New from Phase 3:

10. **COLLECT_INFO answers always stored as `ctx.variables['answers.<variableName>']`** — this is the stable contract between the processor and condition evaluator. Do not change the key format.
11. **Trigger-node lookup must match all 4 trigger types** — `TRIGGER`, `TRIGGER_INBOUND_KEYWORD`, `TRIGGER_ORDER_EVENT`, `TRIGGER_TIME_SINCE_EVENT`. Never revert to matching only `'TRIGGER'`.
12. **COLLECT_INFO uses `index + 1` semantics** — the stored index is the 1-based position of the question that was JUST SENT (i.e. the answer we're waiting for). On resume, `questions[index - 1]` is the question being answered.

---

## Risk Notes

- **MetaClient lacks `sendInteractive`**: COLLECT_INFO choice questions fall back to numbered plain text (`1. Option A\n2. Option B`). When MetaClient gains an interactive send method in a future phase, update `sendQuestion()` in `collectInfo.ts` to use it.
- **Zero `waiting_reply` status guards in `collectInfo.ts`**: The node trusts that `resumeExecution` will only resume it when a buyer message arrives. If the engine ever resumes with an empty `messageText`, the answer stored will be `""`. This is safe — the condition evaluator's `is_set` operator will correctly fail on it.
- **Engine lookup is a linear scan**: `definition.nodes.find(...)` is O(n) over the node list. Acceptable for flows with ≤100 nodes. Not a concern until Phase 4+ introduces very long generated flows.
