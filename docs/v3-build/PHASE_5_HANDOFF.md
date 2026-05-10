# Phase 5 Handoff — Scheduling Confirmation Rewire

**Branch:** `claude/dreamy-tharp-f5c467`
**Status:** Complete ✅
**Next phase:** Phase 6 — (TBD)

---

## What Phase 5 Built

### 1. Instant Confirmation Model

**File:** `apps/api/src/services/scheduling.service.ts` — `handleLLMEnvelope`

New `confirmationModel` parameter added to `handleLLMEnvelope`:

```typescript
async handleLLMEnvelope(
  ...
  overrideConfirmationStaffId?: string,
  confirmationModel?: 'instant' | 'staff_confirm',  // ← NEW
): Promise<string>
```

When `confirmationModel === 'instant'` in the `confirm_booking` branch:
- Appointment is inserted and immediately set to `'confirmed'` status
- Staff notification template is **skipped entirely**
- Buyer receives a confirmation message: `"✅ Appointment kamu *dikonfirmasi*! 📅 [time] 🏥 [service]"`
- No pending_doctor state — appointment is confirmed instantly

When `confirmationModel === 'staff_confirm'` (default):
- Existing flow: appointment set to `'pending_doctor'`, staff notified via template

### 2. Service-Level Confirmation Staff Fallback

**File:** `apps/api/src/services/scheduling.service.ts` — `handleLLMEnvelope`

Staff notification priority (for staff_confirm model):
1. `overrideConfirmationStaffId` (from `START_SCHEDULING` node config or AI Playbook)
2. `service.confirmationStaffId` (from the services DB table) ← **NEW fallback**
3. Slot staff (the staff member the buyer chose)

This means setting a "Confirmation Staff" on a service in the dashboard is now actually respected during booking flow — previously only the explicit node override was used.

### 3. `confirmationModel` Wired from Conversation Handler

**File:** `apps/api/src/services/conversation.service.ts` — `handleScheduling`

`overrideConfirmationModel` (read from `playbookOverride.confirmationModel` at line 617) is now passed as the 6th argument to `handleLLMEnvelope`. Previously it was read but never used.

```typescript
const replyText = await this.schedulingService.handleLLMEnvelope(
  conv.tenantId,
  { id: conv.id, state: conv.state },
  buyer,
  envelope,
  assignedStaffId,
  overrideConfirmationModel as 'instant' | 'staff_confirm' | undefined,  // ← WIRED
);
```

### 4. Decline → Re-Present Slots (API + Worker)

**Files:**
- `apps/api/src/services/scheduling.service.ts` — `handleStaffButtonReply`
- `apps/worker/src/services/webhookMessage.processor.ts` — `handleStaffButtonReply`

Old behaviour: staff declines → cancel appointment → hardcoded "balas dengan kata kunci booking untuk mulai ulang".

New behaviour:
1. Appointment cancelled
2. Conversation state reset from `SCHEDULING_CONFIRMED` → `SCHEDULING` so the buyer's next message re-enters the scheduling LLM handler (no keyword needed)
3. Service looked up from `appt.serviceId`
4. `getAvailableSlots(tenantId, serviceName, undefined, 3)` called
5. If slots available: sends buyer a numbered slot list (same format as `check_availability` response)
6. If no slots: "tidak ada jadwal lain yang tersedia. Silakan hubungi kami langsung."
7. On any error fetching slots: fallback "Balas *booking* untuk mencoba jadwal lain."

Both the API service (`SchedulingService.handleStaffButtonReply`) and the worker's local copy (`handleStaffButtonReply` function in `webhookMessage.processor.ts`) were updated to have identical behaviour.

### 5. `serviceId` Stored in `playbookOverride`

**Files:**
- `packages/db/src/schema/conversations.ts` — `PlaybookOverrideData` type
- `packages/flow-engine/src/nodeProcessors/startScheduling.ts`

`PlaybookOverrideData` staff variant updated:
```typescript
| { type: 'staff'; staffId?: string; confirmationModel?: 'instant' | 'staff_confirm'; serviceId?: string }
```

`staffId` is now **optional** (was required). This allows override records when only `serviceId` or `confirmationModel` is set (no explicit staffId).

`startScheduling.ts` writes the override when any of `assignedStaffId`, `serviceId`, or `confirmationModel` are set in the node config:
```typescript
if (config.assignedStaffId || config.serviceId || config.confirmationModel) {
  const override: PlaybookOverrideData = {
    type: 'staff',
    ...(config.assignedStaffId ? { staffId: config.assignedStaffId } : {}),
    ...(config.confirmationModel ? { confirmationModel: config.confirmationModel } : {}),
    ...(config.serviceId ? { serviceId: config.serviceId } : {}),
  };
  patch.playbookOverride = override;
}
```

### 6. Services Dashboard — `confirmationModel` UI

**Files:**
- `apps/dashboard/src/pages/Services/ServicesPage.tsx`
- `apps/dashboard/src/hooks/useScheduling.ts`

`ServiceRow` type now includes `confirmationModel?: 'staff_confirm' | 'instant'`.
Create/update mutation types updated to accept `confirmationModel`.

In the service form modal, a **Confirmation Model** radio group is shown before the confirmation staff selector:
- ✋ **Staff Approval** (default) — staff confirms each booking
- ⚡ **Instant Confirm** — bookings auto-confirmed immediately

Service cards now show a badge:
- `⚡ Instant` badge for instant services
- `✋ Staff Approval` + confirmation staff name badge for staff_confirm services

---

## Invariants Phase 6 Must Preserve

1. **Decline always re-presents slots** — Never send a "restart with a keyword" message. If slot fetch fails, use the fallback text, but always try to fetch first.

2. **Both copies of `handleStaffButtonReply` must stay in sync** — The API service (`SchedulingService`) and the worker local function are separate code paths for the same behaviour. If one changes, update both.

3. **`staffId` is optional in `PlaybookOverrideData`** — Consumers must handle missing `staffId` gracefully. The conversation handler at line 616 does: `assignedStaffId = schedOverride.staffId` — if undefined, `assignedStaffId` is undefined, which is correct (falls back to service confirmation staff or slot staff).

4. **Instant confirmation skips `pending_doctor` entirely** — The appointment goes directly to `'confirmed'`. The `SCHEDULING_CONFIRMED` conversation state transition still happens (caller at line 661 in conversation.service.ts), but that's fine — it just means the conv stays in a non-interactive state which is correct for a completed booking.

5. **`confirmationModel` in the DB services table** — The column exists (`varchar confirmation_model DEFAULT 'staff_confirm'`). The API routes for CRUD already pass through unknown fields. Verify the route handler explicitly reads `confirmationModel` from the request body.

6. **Service-level confirmation staff fallback chain** — Do not remove the `getConfirmationStaff` call. It's the glue between the services dashboard (where merchants set who confirms per service) and the booking flow.

---

## Files Changed in Phase 5

### Modified
- `packages/db/src/schema/conversations.ts` — `staffId` optional, `serviceId` added to PlaybookOverrideData
- `packages/flow-engine/src/nodeProcessors/startScheduling.ts` — store serviceId + handle no-staffId case
- `apps/api/src/services/scheduling.service.ts` — instant confirmation, service-staff fallback, decline re-presents slots, add `conversations` import
- `apps/api/src/services/conversation.service.ts` — pass `overrideConfirmationModel` to `handleLLMEnvelope`
- `apps/worker/src/services/webhookMessage.processor.ts` — decline path re-presents slots
- `apps/dashboard/src/hooks/useScheduling.ts` — `confirmationModel` in ServiceRow + mutation types
- `apps/dashboard/src/pages/Services/ServicesPage.tsx` — confirmationModel radio + card badges

### Created
- `docs/v3-build/PHASE_5_HANDOFF.md` (this file)
