# Phase 1 Handoff — DB Foundations

**Status:** Complete  
**Branch:** `claude/dreamy-tharp-f5c467`  
**PRD reference:** LynkBot v3 Core Systems PRD §1.2, §3.2, §4

---

## What Phase 1 Did

Phase 1 laid the entire schema and type foundation for all three PRD problem areas. No application logic was changed — only data shapes, migrations, and the contracts that bind them.

---

## Migrations Applied (run in order)

| File | Table | What It Adds |
|---|---|---|
| `0028_bot_persona.sql` | `tenants` | `bot_name`, `bot_tone`, `bot_default_language`, `bot_greeting_style`, `bot_avatar_emoji`, `bot_custom_instructions`, `staff_confirmation_template_name` |
| `0029_scheduling_confirmation_model.sql` | `services` | `confirmation_model` (default: `'staff_confirm'`), `confirmation_template_name` |
| `0030_playbook_override_jsonb.sql` | `conversations` | Converts `playbook_override` from `VARCHAR(50)` to `JSONB` using a `USING` clause that migrates all existing rows |

**Run order matters:** 0028 → 0029 → 0030. The JSONB migration (0030) is safe to run on live data — the `USING` clause handles all three cases: NULL → NULL, `'staff:<uuid>'` → `{ type:'staff', staffId }`, anything else → `{ type:'playbook', intentKey }`.

---

## Schema Changes

### `packages/db/src/schema/tenants.ts`
- Added 7 bot persona columns + `staffConfirmationTemplateName`
- **Exported new type:** `BotTone = 'friendly' | 'formal' | 'playful'`

### `packages/db/src/schema/scheduling.ts`
- Added `confirmationModel: varchar(20).default('staff_confirm')` to `services` table
- Added `confirmationTemplateName: varchar(100)` to `services` table
- **Exported new type:** `ConfirmationModel = 'staff_confirm' | 'instant'`
- Added `import { varchar }` to the file (was missing)

### `packages/db/src/schema/conversations.ts`
- Changed `playbookOverride` from `varchar('playbook_override', { length: 50 })` → `jsonb('playbook_override').$type<PlaybookOverrideData>()`
- **Exported new type:**
  ```typescript
  type PlaybookOverrideData =
    | { type: 'staff'; staffId: string; confirmationModel?: 'instant' | 'staff_confirm' }
    | { type: 'playbook'; intentKey: string };
  ```

All three new types are re-exported from `@lynkbot/db` via `packages/db/src/schema/index.ts → packages/db/src/index.ts`.

---

## Flow Engine Types (`packages/flow-engine/src/types.ts`)

### New NodeType values
```
TRIGGER_INBOUND_KEYWORD   — keyword-match entry point (replaces TRIGGER for new flows)
TRIGGER_ORDER_EVENT       — order lifecycle entry point
TRIGGER_TIME_SINCE_EVENT  — time-based scheduled entry point
COLLECT_INFO              — sequential question collection from buyer (new in v3)
```
`TRIGGER` is kept for backward compat with flows saved before v3.

### New TriggerType value
`'order_event'` added to the `TriggerType` union.

### `StartSchedulingConfig` extended
```typescript
confirmationModel?: 'instant' | 'staff_confirm';  // NEW
serviceId?: string;                                 // NEW
```

### New interfaces added
```typescript
CollectInfoQuestion { id, promptText, variableName, type, choices?, required }
CollectInfoConfig   { questions, onComplete, timeoutMs? }
```

### `ConditionField` union extended
Added `` `answers.${string}` `` so IF_CONDITION nodes can branch on COLLECT_INFO answers.

### `TriggerContext` extended
Added `orderId?: string` for order event triggers.

---

## Callers Updated — `playbookOverride` JSONB Migration

All sites that read or write `conversations.playbookOverride` were updated to use `PlaybookOverrideData`. Zero old `startsWith('staff:')` patterns remain.

| File | Sites | Change |
|---|---|---|
| `packages/flow-engine/src/nodeProcessors/startScheduling.ts` | 1 write | Writes `{ type: 'staff', staffId, confirmationModel? }` |
| `packages/flow-engine/src/nodeProcessors/activatePlaybook.ts` | 1 write | Writes `{ type: 'playbook', intentKey }` |
| `apps/api/src/services/conversation.service.ts` | 2 reads | Reads via `schedOverride?.type === 'staff'` and `aiOverride?.type === 'playbook'` |
| `apps/worker/src/services/webhookMessage.processor.ts` | 4 reads | Same pattern applied to post-resume check, `executeSchedulingEnvelope` (booking + reschedule), `sendAiResponse` |

**Note for Phase 5:** `conversation.service.ts` now also extracts `overrideConfirmationModel` from the staff override:
```typescript
const overrideConfirmationModel = schedOverride.confirmationModel;
```
This variable is declared but not yet passed to `handleLLMEnvelope()`. Phase 5 will add the `overrideConfirmationModel` parameter to `handleLLMEnvelope` and thread it through the `confirm_booking` branch.

---

## What Phase 2 Must Do

Phase 2 is the **Bot Persona** phase. It owns:

### 1. `packages/ai/src/prompts/system.ts`
Rebuild `buildSystemPrompt()` with the new interface:
```typescript
interface SystemPromptContext {
  storeName: string;
  productName?: string;
  bookPersonaPrompt?: string | null;
  language: 'id' | 'en';
  playbookContext?: string;
  // New fields (all optional — backward compatible):
  botName?: string | null;
  botTone?: BotTone | null;         // import BotTone from @lynkbot/db
  botGreetingStyle?: string | null;
  botAvatarEmoji?: string | null;    // dashboard display only — NOT in prompt
  botCustomInstructions?: string | null;
}
```

Key logic:
- `const name = ctx.botName?.trim() || ctx.storeName` — never hardcode `"LynkBot"`
- Build `buildToneModifier(tone, lang)` helper
- Append greeting style block if `botGreetingStyle` is set
- Append custom instructions block at end if `botCustomInstructions` is set
- Replace hardcoded `'LynkBot Store'` fallback in both callers:
  - `apps/api/src/services/conversation.service.ts` line ~787
  - `apps/worker/src/services/webhookMessage.processor.ts` line ~1036

### 2. Propagate new fields to both `buildSystemPrompt()` callers
Both callers must load `botName`, `botTone`, `botGreetingStyle`, `botAvatarEmoji`, `botCustomInstructions` from the tenant record and pass them in.

### 3. Fix hardcoded template name in `scheduling.service.ts`
```typescript
// OLD (line 351):
templateName: 'aria_appointment_confirmation',

// NEW — use resolveStaffConfirmationTemplate():
async function resolveStaffConfirmationTemplate(tenantId: string, serviceId: string | null): Promise<string> {
  if (serviceId) {
    const svc = await db.query.services.findFirst({ where: eq(services.id, serviceId) });
    if (svc?.confirmationTemplateName) return svc.confirmationTemplateName;
  }
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  return tenant?.staffConfirmationTemplateName ?? 'appointment_confirmation';
}
```

### 4. API route `GET/PATCH /v1/settings/persona`
Create or add to `apps/api/src/routes/v1/settings.ts`. See PRD §1.6 for full spec. Validation:
- `botTone` must be one of `['friendly', 'formal', 'playful']`
- `botDefaultLanguage` must be `'id'` or `'en'`
- `botName` max 100 chars

### 5. Dashboard UI `apps/dashboard/src/pages/Settings/BotPersonaPage.tsx`
New settings sub-page. See PRD §1.7 for layout spec. Wire into settings nav.

---

## Invariants for All Future Phases

1. **Never write `playbookOverride` as a raw string** — always use `PlaybookOverrideData` shape.
2. **Never import `PlaybookOverrideData` from anywhere except `@lynkbot/db`** — it lives in `packages/db/src/schema/conversations.ts`.
3. **Migrations 0028/0029 must run before any API startup** — columns are referenced by Phase 2 code.
4. **Migration 0030 is idempotent** — safe to re-run; `ADD COLUMN IF NOT EXISTS` on the other two as well.
5. **`TRIGGER` node type is kept** — engine trigger-node lookup (`n.type === 'TRIGGER'`) will be updated in Phase 3 to also match `TRIGGER_INBOUND_KEYWORD`, `TRIGGER_ORDER_EVENT`, `TRIGGER_TIME_SINCE_EVENT`. Do not remove `'TRIGGER'` from the NodeType union.

---

## Files Changed in Phase 1

### Created
- `packages/db/src/migrations/0028_bot_persona.sql`
- `packages/db/src/migrations/0029_scheduling_confirmation_model.sql`
- `packages/db/src/migrations/0030_playbook_override_jsonb.sql`

### Modified
- `packages/db/src/schema/tenants.ts`
- `packages/db/src/schema/scheduling.ts`
- `packages/db/src/schema/conversations.ts`
- `packages/flow-engine/src/types.ts`
- `packages/flow-engine/src/nodeProcessors/startScheduling.ts`
- `packages/flow-engine/src/nodeProcessors/activatePlaybook.ts`
- `apps/api/src/services/conversation.service.ts`
- `apps/worker/src/services/webhookMessage.processor.ts`

### Unchanged (Phase 2+ targets)
- `packages/ai/src/prompts/system.ts` — `buildSystemPrompt()` still hardcodes "LynkBot"
- `apps/api/src/services/scheduling.service.ts` — still hardcodes `'aria_appointment_confirmation'`
- All dashboard files — no UI changes yet

---

## Risk Notes

- **Zero breaking changes to existing API surfaces** — all new columns are nullable with defaults. Existing code reading the tenant/service rows will receive `undefined` for new columns until data is populated.
- **`playbookOverride` JSONB migration** is the highest-risk change. The `USING` clause in 0030 was tested for all three existing value patterns. If migration fails on a custom edge case, the old behavior can be restored by reverting the column type — no data is deleted.
- **`overrideConfirmationModel` is extracted but not yet used** in `conversation.service.ts`. This is intentional — Phase 5 completes the wire-up.
