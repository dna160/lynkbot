# Phase 3 Handoff — Template Studio

> **Read first (in order):**
> 1. `LynkBot_Flow_Engine_PRD_v2.1.md` (project root — north star, authoritative)
> 2. `docs/flow-engine-build/PHASE_PLAN.md` (orchestration overview + compliance invariants)
> 3. `docs/flow-engine-build/PHASE_2_HANDOFF.md` (Phase 2 result — what's already built)
> 4. This file (`PHASE_3_HANDOFF.md`) — concrete deliverables

---

## What Phase 2 Delivered (already committed — 10 commits on top of Phase 1)

- **`packages/flow-engine`** (`@lynkbot/flow-engine`) — full workspace package
  - `types.ts` — complete PRD §5.2 type hierarchy
  - `variableResolver.ts`, `conditionEvaluator.ts`, `cooldownChecker.ts`, `riskScoreCalculator.ts`
  - 13 node processors in `nodeProcessors/`
  - `FlowEngine` class (`engine.ts`) — `handleButtonTrigger`, `executeNode`, `resumeExecution` (stubs for Phase 4: `evaluateTimeTriggers`, `broadcastToSegment`)
  - `index.ts` — public exports
  - **77 unit tests passing**
- **`apps/api/src/routes/v1/flows.ts`** — 9 CRUD routes for `/v1/flows`, risk gate on activation, registered in `index.ts`
- **Meta webhook** extended — button-trigger routing + WAIT_FOR_REPLY resume
- **`apps/worker/src/processors/flowExecution.processor.ts`** — all 4 job types, registered with concurrency=20
- **`/internal/flows/seed-cron`** route — seeds 3 BullMQ repeatable jobs

**Known debt from Phase 2:** `'waiting_reply'` is not in `flowExecutionStatusEnum` in `packages/db/src/schema/flowExecutions.ts`. The engine uses a cast workaround. **Phase 3 must fix this** by adding `'waiting_reply'` to the enum and patching the migration (add a note; the existing SQL migration already has `VARCHAR(20)` so no DB change needed — just the Drizzle enum definition).

**Branch:** `claude/elegant-brattain-b5512a`
**Last commit:** `15bab52`

---

## Goal of Phase 3

Build the **Template Studio** — the system for creating, submitting, tracking, and managing WhatsApp message templates through Meta's Graph API.

Owns: PRD §6 (Feature 2), §11.2 (routes), §11.6 (webhook extension for template status), §12.2 (templateSync.processor).

---

## Working Directory

`/Users/storytellers/Documents/Claude Home/Lynkbot/.claude/worktrees/elegant-brattain-b5512a`

Do **not** push. Do **not** switch branches.

---

## Compliance Invariants (apply to Phase 3)

From PRD §4 and §17:

1. **Interactive Quick-Reply buttons required** on every template that will be used as a flow trigger — enforced in `TemplateStudioService.validateForFlowUse()`.
2. **Max 2 appeal attempts** — `POST /v1/flow-templates/:id/appeal` must return 422 if `appealCount >= 2`.
3. **Template in use by active flow** — `DELETE /v1/flow-templates/:id` must return 409 if the template is referenced by any `flow_definitions` with `status = 'active'`.
4. **Per-tenant MetaClient** — use `getTenantMetaClient(tenantId)` from `apps/api/src/services/_meta.helper.ts`. Never `config.META_ACCESS_TOKEN`.
5. **Template name format** — must be snake_case; validate before submission to Meta.
6. On `DISABLED` webhook event → find all active flows using this template → pause those flow nodes (set flow status to `'paused'`, add note in `description`).

---

## Known Debt to Fix First (before Template Studio work)

Fix `flowExecutionStatusEnum` in `packages/db/src/schema/flowExecutions.ts`:

```typescript
// Current (wrong — missing waiting_reply):
export const flowExecutionStatusEnum = pgEnum('flow_execution_status', [
  'running', 'completed', 'cancelled', 'failed',
]);

// Correct — add waiting_reply:
export const flowExecutionStatusEnum = pgEnum('flow_execution_status', [
  'running', 'waiting_reply', 'completed', 'cancelled', 'failed',
]);
```

No SQL migration change needed — the existing `0005_flow_engine.sql` uses `VARCHAR(20)` for the status column (not a native PG enum type). Just update the Drizzle definition and rebuild `@lynkbot/db`.

---

## Deliverables — Phase 3

### 1. `TemplateStudioService` (`apps/api/src/services/templateStudio.service.ts`)

Read PRD §6 carefully. Implement these methods:

```typescript
export class TemplateStudioService {
  // Create a draft template (local only, not submitted to Meta yet)
  async createDraft(tenantId: string, input: CreateTemplateInput): Promise<FlowTemplate>

  // Update a draft (blocked if status !== 'draft' | 'rejected')
  async updateDraft(tenantId: string, id: string, input: Partial<CreateTemplateInput>): Promise<FlowTemplate>

  // Submit to Meta Graph API: POST /{wabaId}/message_templates
  async submit(tenantId: string, id: string): Promise<FlowTemplate>

  // Resubmit a rejected template (blocked if appealCount >= 2)
  async appeal(tenantId: string, id: string): Promise<FlowTemplate>

  // Pause an active template (sets status='paused' locally; no Meta API call)
  async pause(tenantId: string, id: string): Promise<void>

  // Process Meta webhook status update event
  async handleStatusUpdate(update: {
    metaTemplateId: string | number;
    event: 'APPROVED' | 'REJECTED' | 'DISABLED' | 'FLAGGED' | 'IN_APPEAL' | 'REINSTATED';
    reason?: string;
  }): Promise<void>

  // Poll pending templates (called by templateSync processor)
  async pollPending(tenantId?: string): Promise<void>

  // Sync quality ratings (called by templateSync processor)
  async syncQualityRatings(tenantId?: string): Promise<void>

  // Validate template structure before submission
  private validateForSubmit(template: FlowTemplate): void

  // Validate template will work as a flow trigger (must have Quick Reply buttons)
  validateForFlowUse(template: FlowTemplate): { valid: boolean; reason?: string }
}
```

**`CreateTemplateInput`:**
```typescript
interface CreateTemplateInput {
  name: string;              // snake_case, validated
  displayName?: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;          // default 'id'
  components: MetaTemplateComponent[];  // header/body/footer/buttons
  variableLabels?: Record<string, string>; // {"{{1}}": "Customer Name"}
}
```

**`submit()` logic (PRD §6.2):**
1. Load template, validate name is snake_case
2. Validate component structure (body has required `{{N}}` variables, buttons ≤ 3)
3. If template has `isFlowTrigger` or is referenced by a flow, call `validateForFlowUse()` — must have Quick Reply buttons
4. POST to `/{tenant.wabaId}/message_templates` via `MetaClient` (check if MetaClient has a `submitTemplate` method; if not, use `fetch` or `axios` directly against `https://graph.facebook.com/v23.0/{wabaId}/message_templates`)
5. Store `metaTemplateId`, set `status = 'pending_review'`, set `submittedAt`

**`handleStatusUpdate()` logic (PRD §6.3):**
- `APPROVED` → set `status = 'approved'`, `approvedAt = NOW()`
- `REJECTED` → set `status = 'rejected'`, `rejectionReason = reason`
- `DISABLED` → set `status = 'disabled'`; query `flow_definitions` where `nodes @> '[{"config":{"templateName":"<name>"}}]'` and `status = 'active'`; for each → set `status = 'paused'`, append to `description`
- `FLAGGED` → set `status = 'flagged'`
- `IN_APPEAL` → set `status = 'in_appeal'`
- `REINSTATED` → set `status = 'approved'`

**`pollPending()` logic:**
- Find all `flow_templates` where `status = 'pending_review'` and `submittedAt < NOW() - interval '10 minutes'`
- For each, call Meta Graph API `GET /{metaTemplateId}` to fetch current status
- Update local record if status changed

**Note on MetaClient:** Check if `MetaClient` has methods for template management. If not, call Meta Graph API directly using `node-fetch` or the existing `axios`/`undici` in the project — use whatever HTTP client is already imported in similar services.

### 2. Flow Templates Routes (`apps/api/src/routes/v1/flowTemplates.ts`)

Implement all routes from PRD §11.2:

```
GET    /v1/flow-templates                list (query: status, category, page, limit)
POST   /v1/flow-templates                create draft
GET    /v1/flow-templates/:id            get template
PUT    /v1/flow-templates/:id            update draft (blocked if status != 'draft'|'rejected')
POST   /v1/flow-templates/:id/submit     submit to Meta
POST   /v1/flow-templates/:id/appeal     resubmit (blocked if appealCount >= 2)
POST   /v1/flow-templates/:id/pause      pause active template
DELETE /v1/flow-templates/:id            delete (blocked if in-use by active flow)
```

All routes: `preHandler: [fastify.authenticate, requireFeature('template_studio')]`

`DELETE` guard: query `flow_definitions` for `nodes` JSONB containing the template name AND `status = 'active'`. If found → 409 `{ error: 'template_in_use', message: 'Template is referenced by an active flow.' }`.

`POST /:id/appeal` guard: load template, if `appealCount >= 2` → 422 `{ error: 'appeal_limit_reached', message: 'Max 2 appeals per template. Contact Meta support directly.' }`.

Register in `apps/api/src/index.ts`.

### 3. Webhook Extension for Template Status (`apps/api/src/routes/webhooks/meta.ts`)

Read the existing webhook handler (modified in Phase 2). Add at the top of the POST handler, before the existing button-trigger routing:

```typescript
// Template status updates from Meta
if (change?.field === 'message_template_status_update') {
  const { event, message_template_id, reason } = change.value ?? {};
  templateStudioService.handleStatusUpdate({
    metaTemplateId: message_template_id,
    event,
    reason,
  }).catch(err => request.log.error({ err }, 'Template status update failed'));
  return reply.send(''); // always 200 to Meta
}

// Phone number quality update → risk score recompute (Phase 4 fills this in, stub for now)
if (change?.field === 'phone_number_quality_update') {
  request.log.info({ change }, 'phone_number_quality_update received — Phase 4 will handle');
  return reply.send('');
}
```

The `templateStudioService` instance should be instantiated at module level, same pattern as `flowEngine` (which Phase 2 added).

### 4. Template Sync Processor (`apps/worker/src/processors/templateSync.processor.ts`)

```typescript
import { TemplateStudioService } from '@lynkbot/api/services/templateStudio.service'; // adjust import path
// OR instantiate the service directly if cross-package import isn't set up

export const templateSyncProcessor: Processor = async (job) => {
  const svc = new TemplateStudioService();
  if (job.name === 'template.poll_pending') {
    await svc.pollPending();
  } else if (job.name === 'template.sync_quality') {
    await svc.syncQualityRatings();
  }
};
```

**Important**: The worker cannot import from `apps/api` directly — they are separate apps. Move the service to a shared location OR duplicate the logic in the processor. The cleanest approach: `TemplateStudioService` stays in `apps/api/src/services/`, but the worker processor instantiates its own version by importing from `@lynkbot/db` and `@lynkbot/meta` directly (no cross-app import). Implement the sync logic inline in the processor rather than sharing the service class.

Register in `apps/worker/src/index.ts`:
```typescript
import { templateSyncProcessor } from './processors/templateSync.processor';
new Worker(QUEUES.TEMPLATE_SYNC, templateSyncProcessor, {
  connection: redisConnection,
  concurrency: 5,
}),
```

### 5. Integration Tests (`apps/api/src/routes/__tests__/flowTemplates.test.ts`)

Per PRD §14.2, implement:

- CRUD: create draft, get, update draft, list
- `submit`: mocks Meta API call, verifies `metaTemplateId` stored
- `appeal` blocked at `appealCount >= 2` → 422
- `delete` blocked when template in use by active flow → 409
- `handleStatusUpdate`: APPROVED sets `approvedAt`, DISABLED pauses active flows

All tests use Vitest. Mock `@lynkbot/db` and Meta HTTP calls.

### 6. Dashboard: Template List + Editor Pages

Per PRD §13.4, create:

**`apps/dashboard/src/pages/Templates/TemplateListPage.tsx`**
- Table of templates with columns: Name, Status (badge), Category, Language, Quality Rating, Actions
- Status badge colors: draft=slate, pending_review=yellow, approved=green, rejected=red, disabled=red/strikethrough
- Action buttons: Edit (if draft/rejected), Submit (if draft), Pause (if approved), Delete (if draft)
- Uses `flowTemplatesApi` from `lib/api.ts`

**`apps/dashboard/src/pages/Templates/TemplateEditorPage.tsx`**
- Form fields: Display Name, Name (snake_case, auto-derived from display name), Category, Language
- Component builder: header (optional), body (required, {{N}} variables), footer (optional), buttons (up to 3)
- Live preview panel showing WhatsApp bubble mockup
- Variable label mapper: for each `{{N}}` detected in body, let user label it (e.g. "{{1}}" → "Customer Name")
- Submit button calls `POST /v1/flow-templates` (create) or `PUT /v1/flow-templates/:id` (update)

**`apps/dashboard/src/pages/Templates/components/TemplatePreview.tsx`**
- WhatsApp bubble mockup: dark green background, white text bubble, renders header image placeholder or text, body with variable placeholders, footer, quick-reply buttons
- Updates live as user types

**Add to sidebar** (`apps/dashboard/src/components/Sidebar.tsx`):
```tsx
{ to: '/dashboard/templates', label: 'Templates', icon: <TemplateIcon /> }
```

**Add routes** to `apps/dashboard/src/App.tsx`:
```tsx
<Route path="/dashboard/templates" element={<TemplateListPage />} />
<Route path="/dashboard/templates/new" element={<TemplateEditorPage />} />
<Route path="/dashboard/templates/:id/edit" element={<TemplateEditorPage />} />
```

**Add API client** to `apps/dashboard/src/lib/api.ts`:
```typescript
export const flowTemplatesApi = {
  list: (params?: { status?: string; category?: string; page?: number; limit?: number }) =>
    api.get('/flow-templates', { params }),
  get: (id: string) => api.get(`/flow-templates/${id}`),
  create: (data: CreateTemplatePayload) => api.post('/flow-templates', data),
  update: (id: string, data: Partial<CreateTemplatePayload>) => api.put(`/flow-templates/${id}`, data),
  submit: (id: string) => api.post(`/flow-templates/${id}/submit`),
  appeal: (id: string) => api.post(`/flow-templates/${id}/appeal`),
  pause: (id: string) => api.post(`/flow-templates/${id}/pause`),
  delete: (id: string) => api.delete(`/flow-templates/${id}`),
};
```

---

## Where to Find Existing Patterns

- Route pattern: `apps/api/src/routes/v1/broadcasts.ts` — match this exactly (FastifyPluginAsync, authenticate preHandler, `request.user.tenantId`)
- Auth user extraction: `(request as any).user?.tenantId as string`
- DB query pattern: `db.query.flowTemplates.findMany({ where: eq(flowTemplates.tenantId, tenantId) })`
- Existing MetaClient methods: `sendTemplate`, `listTemplates`, `getPhoneNumberInfo` — see `packages/meta/src/MetaClient.ts`
- Webhook handler structure: `apps/api/src/routes/webhooks/meta.ts` (modified by Phase 2)
- Dashboard component style: match `apps/dashboard/src/pages/Buyers/BuyersPage.tsx` (dark theme, slate colors, indigo accents)

---

## Quality Gates (must all pass)

```bash
pnpm -F @lynkbot/db build           # after fixing flowExecutionStatusEnum
pnpm -F @lynkbot/flow-engine build  # rebuild after db change
pnpm -F api typecheck               # zero errors
pnpm -F worker typecheck            # zero errors
pnpm -F api test                    # flowTemplates.test.ts passes
pnpm -F dashboard typecheck         # zero errors (if tsconfig exists for dashboard)
```

---

## Commits

```
fix(db): add waiting_reply to flowExecutionStatusEnum
feat(api): TemplateStudioService — CRUD, Meta submit, status handling
feat(api): /v1/flow-templates routes (8 endpoints)
feat(api): extend Meta webhook for template status + quality updates
feat(worker): templateSync processor + register in worker index
test(api): flowTemplates integration tests
feat(dashboard): Templates list + editor pages + sidebar entry
```

Conventional Commits. Co-author: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Reporting Back

Append `## Phase 3 Result` to this file with:
- Files created / modified (one bullet each)
- Test results
- typecheck/lint status per package
- Anything skipped with reason
- **Phase 4 notes**: what Re-engagement + Risk Scoring phase needs to know

Return a final summary under 400 words.
