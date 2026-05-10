# Phase 2 Handoff — Bot Persona

**Status:** Complete  
**Branch:** `claude/dreamy-tharp-f5c467`  
**PRD reference:** LynkBot v3 Core Systems PRD §1.2, §1.5, §1.6, §1.7

---

## What Phase 2 Did

Phase 2 eliminated all hardcoded bot identity from the AI pipeline and wired the tenant-configurable persona (name, tone, greeting style, custom instructions) into every system prompt. It also resolved the hardcoded `aria_appointment_confirmation` template name in the scheduling service, added the persona API, and built the dashboard UI.

---

## Files Changed in Phase 2

### Modified
- `packages/ai/src/prompts/system.ts` — full rebuild
- `apps/api/src/services/conversation.service.ts` — persona fields propagated to `buildSystemPrompt()`
- `apps/worker/src/services/webhookMessage.processor.ts` — same
- `apps/api/src/services/scheduling.service.ts` — `tenants` import added, `resolveStaffConfirmationTemplate()` added, `sendStaffConfirmationTemplate()` updated
- `apps/api/src/index.ts` — `settingsRoutes` imported and registered
- `apps/dashboard/src/App.tsx` — `BotPersonaPage` imported, `settings/persona` route added
- `apps/dashboard/src/components/Sidebar.tsx` — Settings standalone link → Settings group (WhatsApp + Bot Persona)

### Created
- `apps/api/src/routes/v1/settings.ts` — `GET/PATCH /v1/settings/persona`
- `apps/dashboard/src/pages/Settings/BotPersonaPage.tsx`

---

## Key Changes in Detail

### `packages/ai/src/prompts/system.ts`

`buildSystemPrompt()` now accepts and uses:

```typescript
interface SystemPromptContext {
  storeName: string;
  productName?: string;
  bookPersonaPrompt?: string | null;
  language: 'id' | 'en';
  playbookContext?: string;
  // v3 — all optional, backward compatible:
  botName?: string | null;
  botTone?: BotTone | null;          // import BotTone from @lynkbot/db
  botGreetingStyle?: string | null;
  botAvatarEmoji?: string | null;    // NOT injected into prompt
  botCustomInstructions?: string | null;
}
```

Key logic:
- `const name = ctx.botName?.trim() || ctx.storeName` — `storeName` fallback, never hardcoded
- `buildToneModifier(tone, lang)` — bilingual tone block injected after base prompt
- `botGreetingStyle` → injected as `GAYA SAPAAN:`/`GREETING STYLE:` block
- `botCustomInstructions` → appended last as `INSTRUKSI KHUSUS:`/`CUSTOM INSTRUCTIONS:` block
- `botAvatarEmoji` is accepted in the interface but **intentionally not written into the prompt** — it's dashboard-display-only

**Breaking change vs Phase 1 state:** `storeName ?? 'LynkBot Store'` fallback is gone. Both callers now pass `storeName ?? ''`. The bot's identity always comes from `botName || storeName` — never a hardcoded string.

### `apps/api/src/services/scheduling.service.ts`

New module-level helper (not exported — internal only):

```typescript
async function resolveStaffConfirmationTemplate(
  tenantId: string,
  serviceId: string | null,
): Promise<string> {
  if (serviceId) {
    const svc = await db.query.services.findFirst({ where: eq(services.id, serviceId) });
    if (svc?.confirmationTemplateName) return svc.confirmationTemplateName;
  }
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  return tenant?.staffConfirmationTemplateName ?? 'appointment_confirmation';
}
```

Resolution priority: **service-level template → tenant-level template → system default** (`'appointment_confirmation'`).

`sendStaffConfirmationTemplate()` now accepts `serviceId?: string | null` and calls this helper. The call site at `handleLLMEnvelope` passes `envelope.service_id`.

**Note for Phase 5:** The buyer-facing template at `scheduling.service.ts` line ~425 still uses `'aria_appointment_confirmation_buyer'` hardcoded. Phase 5 owns the full confirmation flow rewire and should apply the same resolver pattern to the buyer-side template.

### `apps/api/src/routes/v1/settings.ts`

```
GET  /api/v1/settings/persona   → returns all 6 persona fields from tenant record
PATCH /api/v1/settings/persona  → partial update, all fields optional, zod-validated
```

Validation:
- `botTone`: must be `'friendly' | 'formal' | 'playful'` or `null`
- `botDefaultLanguage`: must be `'id' | 'en'` or `null`
- `botName`: max 100 chars
- `botGreetingStyle`: max 500 chars
- `botCustomInstructions`: max 2000 chars
- `botAvatarEmoji`: max 10 chars

Route uses `fastify.authenticate` — tenant-scoped.

### `apps/dashboard/src/pages/Settings/BotPersonaPage.tsx`

Sections:
1. **Identity** — avatar emoji (preset picker + custom input), bot name, default language toggle
2. **Tone** — radio group (friendly / formal / playful) with descriptions
3. **Greeting Style** — textarea with char counter
4. **Custom Instructions** — monospace textarea with char counter

Calls `GET /v1/settings/persona` on mount, `PATCH /v1/settings/persona` on save. Uses existing `useToast` pattern.

---

## Both `buildSystemPrompt()` Callers Updated

| File | Line | Change |
|---|---|---|
| `apps/api/src/services/conversation.service.ts` | ~786 | Added `botName`, `botTone`, `botGreetingStyle`, `botCustomInstructions` from `tenant` |
| `apps/worker/src/services/webhookMessage.processor.ts` | ~1035 | Same |

Both callers already load the full tenant record (`db.query.tenants.findFirst`). No additional DB queries needed — the new columns are included in the existing `findFirst` (no `columns` restriction on those fetches).

---

## What Phase 3 Must Do

Phase 3 is the **COLLECT_INFO Engine** phase.

### 1. Create `collectInfo.ts` processor
`packages/flow-engine/src/nodeProcessors/collectInfo.ts`

The COLLECT_INFO node asks a sequence of questions to the buyer and stores answers in conversation state. It uses the `CollectInfoConfig` / `CollectInfoQuestion` interfaces already defined in Phase 1.

Flow:
1. Send `questions[currentIndex].promptText` to buyer
2. Persist answer to `conversations.metadata.answers[variableName]`
3. Advance `currentIndex`; when exhausted, branch on `config.onComplete`

The node must be **resumable** — when the buyer replies, the flow engine resumes at the COLLECT_INFO node with the answer in context (same pattern as AGENT nodes).

### 2. Register in `processorRegistry`
`packages/flow-engine/src/nodeProcessors/index.ts`

```typescript
[NodeType.COLLECT_INFO]: collectInfoProcessor,
```

### 3. Update trigger-node lookup in the engine
The engine finds the first node using `n.type === 'TRIGGER'`. Update to also match:
- `TRIGGER_INBOUND_KEYWORD`
- `TRIGGER_ORDER_EVENT`
- `TRIGGER_TIME_SINCE_EVENT`

The old `TRIGGER` value must remain accepted for backward compat.

Location: find `n.type === 'TRIGGER'` in `packages/flow-engine/src/`.

### 4. Update `resumeExecution` to handle COLLECT_INFO nodes
COLLECT_INFO is like an AGENT node — the engine pauses at it and must be told to resume. The resume path needs to advance the question index and re-enter the node.

### 5. Update variable resolver to support `answers.*` namespace
IF_CONDITION nodes can branch on `answers.${variableName}`. The condition evaluator must resolve these from `conversations.metadata.answers`.

### 6. Add COLLECT_INFO to the flow editor palette and config panel
Dashboard: flow editor node palette and the config side-panel for COLLECT_INFO nodes.

---

## Invariants Inherited from Phase 1 (still apply)

1. Never write `playbookOverride` as a raw string — always `PlaybookOverrideData` shape.
2. Never import `PlaybookOverrideData` from anywhere except `@lynkbot/db`.
3. Migrations 0028/0029 must run before API startup.
4. `TRIGGER` node type is kept — do not remove from NodeType union.
5. `overrideConfirmationModel` is extracted in `conversation.service.ts` but not yet wired to `handleLLMEnvelope()` — Phase 5 completes this.

## New Invariants from Phase 2

6. **Never hardcode a bot name string** (`"LynkBot"`, `"LynkBot Store"`, etc.) in any system prompt or AI caller. Always derive from `botName || storeName`.
7. **`buildSystemPrompt()` callers must pass `botName`, `botTone`, `botGreetingStyle`, `botCustomInstructions`** from the tenant record. Any new caller that skips these fields will produce a degraded persona experience.
8. **`botAvatarEmoji` is display-only** — it must never appear in system prompts sent to the LLM.
9. **`resolveStaffConfirmationTemplate()` is the single source of truth** for staff confirmation template names. Never hardcode a template string in `sendStaffConfirmationTemplate()` or any scheduling caller.

---

## Risk Notes

- **`storeName ?? ''` fallback**: If a tenant's `storeName` is null/empty and `botName` is also null, the bot will introduce itself without a name. This is an edge case in the data — the onboarding flow always sets `storeName`. Safe.
- **New DB columns queried but not column-restricted**: Both `buildSystemPrompt()` callers use `db.query.tenants.findFirst` without a `columns` filter, so they already receive all new bot persona columns. No risk of missing data.
- **`resolveStaffConfirmationTemplate()` makes 1–2 extra DB queries per booking**: Acceptable for a low-frequency operation. If this becomes a hot path, results could be memoized per-request.
