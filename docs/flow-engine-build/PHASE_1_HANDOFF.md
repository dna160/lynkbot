# Phase 1 Handoff — Foundation

> **Read first**:
> 1. `LynkBot_Flow_Engine_PRD_v2.1.md` (project root, north star)
> 2. `docs/flow-engine-build/PHASE_PLAN.md` (overview)

## Goal of Phase 1

Land the **foundational infrastructure** that every later phase depends on:

- DB schema changes (migration `0005` + 6 new schema files + 3 modified)
- Per-tenant `MetaClient` pattern (the entire codebase currently uses `config.META_*`)
- WABA pool table + assignment logic
- Onboarding two-path UX (pool assignment OR manual Meta cred entry)
- AES-256 crypto utility for storing access tokens
- `featureGate` middleware (stubbed, ready for real tier rules)
- BullMQ queues update (remove WATI_STATUS, add 3 new — but no processors yet)
- Delete dead code: `infra/DEPLOYMENT.md` AND root `DEPLOYMENT.md` (whichever exist), `apps/worker/src/processors/watiStatus.processor.ts`

## Existing State (verified by repo exploration)

- Worktree: `/Users/storytellers/Documents/Claude Home/Lynkbot/.claude/worktrees/elegant-brattain-b5512a`
- Branch: `claude/elegant-brattain-b5512a` (clean)
- Migrations exist `0000`–`0004`. **Next is `0005_flow_engine.sql`**.
- `packages/db/src/schema/tenants.ts` already has: `id, lynkUserId, storeName, wabaId, watiApiKeyEnc, watiAccountStatus, metaPhoneNumberId, displayPhoneNumber, subscriptionTier (trial|growth|pro|scale enum), subscriptionExpiresAt, createdAt, updatedAt`
- `packages/db/src/schema/buyers.ts` columns: `id, tenantId, waPhone, displayName, preferredLanguage, totalOrders, totalSpendIdr, lastOrderAt, tags (JSONB), notes, doNotContact`
- `packages/db/src/schema/broadcasts.ts` columns: `id, tenantId, templateName, templateParams, audienceFilter, recipientCount, sentCount, failedCount, status, errorLog, createdAt, completedAt`
- `packages/meta/src/MetaClient.ts` — constructor `(accessToken, phoneNumberId)`, methods: `sendText, sendTemplate, markRead, getPhoneNumberInfo, testConnection, listTemplates`. **No `fromTenant` static yet.**
- `apps/api/src/services/{notification,conversation,checkout,payment}.service.ts` — all use `new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID)`
- `apps/api/src/services/onboarding.service.ts` exists — currently does NOT touch waba_pool (table doesn't exist yet)
- `apps/worker/src/processors/watiStatus.processor.ts` — confirmed no-op stub
- `packages/shared/src/constants/queues.ts` — has `WATI_STATUS` to remove, lacks `FLOW_EXECUTION`, `TEMPLATE_SYNC`, `RISK_SCORE`
- `apps/api/src/config.ts` — `META_*` env vars are already optional with default `''`. No required changes there other than adding `WABA_POOL_ENCRYPTION_KEY`.
- Dashboard onboarding page: `apps/dashboard/src/pages/OnboardingPage.tsx` exists.
- Test framework: **Vitest**.

## Compliance Invariants (do not violate)

See `PHASE_PLAN.md` §"Compliance Invariants". For Phase 1 specifically:
- **Per-tenant MetaClient** — every refactored service MUST use `MetaClient.fromTenant(tenant)`.
- **Crypto helper** — AES-256-GCM with random IV per encryption; never log plaintext tokens.
- **WABA pool tokens** are stored encrypted with `WABA_POOL_ENCRYPTION_KEY`.
- **Onboarding**: do NOT auto-activate flows; do NOT skip `doNotContact` checks anywhere.

## Deliverables — Phase 1

### 1. SQL Migration

**Create `packages/db/src/migrations/0005_flow_engine.sql`** with the contents of PRD §10.1.
Verbatim — do not edit the SQL. (`flow_definitions`, `flow_executions`, `flow_templates`,
`buyer_broadcast_log`, `tenant_risk_scores`, `waba_pool`, plus the `tenants`/`broadcasts`/`buyers` ALTERs.)

### 2. Drizzle Schema Files (NEW)

Create six new files in `packages/db/src/schema/`:

- `wabaPool.ts` — table `waba_pool`
- `flowDefinitions.ts` — table `flow_definitions`
- `flowExecutions.ts` — table `flow_executions` (include the partial-unique index notes as comments; Drizzle index DSL doesn't always express partial-unique cleanly — the SQL migration owns the partial index).
- `flowTemplates.ts` — table `flow_templates`
- `buyerBroadcastLog.ts` — table `buyer_broadcast_log`
- `tenantRiskScores.ts` — table `tenant_risk_scores`

Style — match existing schema files (`pgTable`, `uuid`, `varchar`, `jsonb`, `timestamp`, etc.).

Export all six from `packages/db/src/schema/index.ts`.

### 3. Drizzle Schema Files (MODIFY)

- `packages/db/src/schema/tenants.ts` — ADD: `metaAccessToken (text)`, `messagingTier (integer, notNull, default 1)`, `wabaQualityRating (varchar(10))`, `lastRiskScoreAt (timestamp)`
- `packages/db/src/schema/broadcasts.ts` — ADD: `flowId (uuid, fk → flow_definitions.id, nullable)`, `riskScoreAtSend (integer)`
- `packages/db/src/schema/buyers.ts` — ADD: `activeFlowCount (integer, notNull, default 0)`

### 4. MetaClient.fromTenant

Modify `packages/meta/src/MetaClient.ts` — add per PRD §3.4:

```typescript
static fromTenant(tenant: { metaAccessToken: string | null; metaPhoneNumberId: string | null }): MetaClient {
  if (!tenant.metaAccessToken || !tenant.metaPhoneNumberId) {
    throw new Error('Tenant has no active WABA credentials');
  }
  return new MetaClient(tenant.metaAccessToken, tenant.metaPhoneNumberId);
}
```

### 5. AES-256-GCM Crypto Util (NEW)

Create `apps/api/src/utils/crypto.ts` with two pure functions:

```typescript
encrypt(plaintext: string, keyHex: string): string  // returns "iv:authTag:ciphertext" base64-bundled
decrypt(bundled: string, keyHex: string): string
```

Use `node:crypto` `createCipheriv('aes-256-gcm', ...)`. Random 12-byte IV per call.
Throw on invalid key length or malformed input. NEVER log plaintext or key.

Add a vitest test file `apps/api/src/utils/__tests__/crypto.test.ts` covering:
- round-trip encrypt → decrypt yields original
- wrong key fails decryption
- malformed bundle throws
- different IVs produce different ciphertexts for same plaintext

### 6. Per-Tenant MetaClient Refactor

For each of:
- `apps/api/src/services/notification.service.ts`
- `apps/api/src/services/conversation.service.ts`
- `apps/api/src/services/checkout.service.ts`
- `apps/api/src/services/payment.service.ts`

Replace any `new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID)` with a private async method:

```typescript
private async getMetaClient(tenantId: string): Promise<MetaClient> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant?.metaAccessToken || !tenant?.metaPhoneNumberId) {
    throw new Error(`Tenant ${tenantId} has no active WABA credentials`);
  }
  return MetaClient.fromTenant({
    metaAccessToken: tenant.metaAccessToken,
    metaPhoneNumberId: tenant.metaPhoneNumberId,
  });
}
```

Important: **Do not break existing call sites.** If a method already takes `tenantId`, plumb through. If it doesn't, add it as a parameter and update upstream callers. Run `pnpm typecheck` to find broken call sites.

`tenant.metaAccessToken` is encrypted at rest. Add a helper:
```typescript
// in apps/api/src/services/_meta.helper.ts (new file)
export async function loadTenantForMeta(tenantId: string): Promise<{ metaAccessToken: string; metaPhoneNumberId: string }> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant?.metaAccessToken || !tenant?.metaPhoneNumberId) {
    throw new Error(`Tenant ${tenantId} has no active WABA credentials`);
  }
  return {
    metaAccessToken: decrypt(tenant.metaAccessToken, config.WABA_POOL_ENCRYPTION_KEY),
    metaPhoneNumberId: tenant.metaPhoneNumberId,
  };
}
```

(Note: `tenants.metaAccessToken` is the encrypted token. Decrypt before passing to MetaClient.)

### 7. WABA Pool Service + Onboarding Integration

**Create `apps/api/src/services/wabaPool.service.ts`**:

```typescript
export class WabaPoolService {
  // Find next available pool account, mark assigned, write tenant row
  async assignToTenant(tenantId: string): Promise<{ assigned: true; phoneNumberId: string } | { assigned: false; reason: 'pool_exhausted' }>;
  async releaseFromTenant(tenantId: string): Promise<void>;
  async listPool(): Promise<Array<{ id: string; phoneNumberId: string; displayPhone: string; status: string; assignedTo: string | null }>>;
  async addToPool(input: { phoneNumberId: string; displayPhone: string; wabaId: string; accessToken: string }): Promise<void>; // encrypts the token
}
```

`assignToTenant` runs in a single transaction:
1. `SELECT id FROM waba_pool WHERE status = 'available' LIMIT 1 FOR UPDATE SKIP LOCKED`
2. If none → return `{ assigned: false, reason: 'pool_exhausted' }`
3. Update `waba_pool` row → `status = 'assigned'`, `assigned_to = tenantId`, `assigned_at = NOW()`
4. Update `tenants` row → set `metaPhoneNumberId`, `wabaId`, `metaAccessToken` (encrypted), `watiAccountStatus = 'active'`
5. Return `{ assigned: true, phoneNumberId }`

**Modify `apps/api/src/services/onboarding.service.ts`** to:
- Add a method `completeOnboarding(input)` accepting either `{ mode: 'pool' }` or `{ mode: 'manual', metaPhoneNumberId, wabaId, metaAccessToken }`
- Pool path: call `WabaPoolService.assignToTenant`. On exhaustion: existing fallback (`opsTickets` entry with `type='waba_assignment_required'`).
- Manual path: validate the three creds are non-empty; encrypt `metaAccessToken` with `WABA_POOL_ENCRYPTION_KEY`; write to tenant row; set `watiAccountStatus = 'active'`.
- After either path: optionally make a test call to `MetaClient.testConnection()` and report success/failure to caller.

### 8. Internal WABA Pool Routes

**Create `apps/api/src/routes/internal/wabaPool.ts`**:

```
GET  /internal/waba-pool        list pool accounts + assignment status (X-Internal-Api-Key required)
POST /internal/waba-pool        add account to pool (body: phoneNumberId, displayPhone, wabaId, accessToken)
```

Use existing internal-API-key middleware (look for it; if absent, create `apps/api/src/middleware/internalApiKey.ts` checking `request.headers['x-internal-api-key'] === config.LYNK_INTERNAL_API_KEY`).

Register the route in `apps/api/src/index.ts`.

### 9. Onboarding Routes (User-Facing)

**Modify or create `apps/api/src/routes/v1/onboarding.ts`** (file may already exist):

```
POST /v1/onboarding/complete   { mode: 'pool' | 'manual', metaPhoneNumberId?, wabaId?, metaAccessToken? }
GET  /v1/onboarding/status     { onboarded: boolean, mode: 'pool'|'manual'|null, displayPhone?: string, watiStatus: string }
```

Apply: `preHandler: [fastify.authenticate]` (no feature gate yet — onboarding is universal).

### 10. featureGate Middleware

**Create `apps/api/src/middleware/featureGate.ts`** per PRD §2.7 — stubbed pass-through but type-safe:

```typescript
export type FeatureFlag =
  | 'flow_builder' | 'template_studio' | 'flow_reengagement'
  | 'ai_flow_generator' | 'risk_score';

export function requireFeature(_feature: FeatureFlag) {
  return async (_request: FastifyRequest, _reply: FastifyReply) => {
    // TODO: implement real tier checks when business rules are finalized.
    // For now: all authenticated tenants pass.
  };
}
```

### 11. Queues Update

Modify `packages/shared/src/constants/queues.ts`:
- REMOVE `WATI_STATUS`
- ADD: `FLOW_EXECUTION: 'lynkbot-flow-execution'`, `TEMPLATE_SYNC: 'lynkbot-template-sync'`, `RISK_SCORE: 'lynkbot-risk-score'`

Modify `apps/worker/src/index.ts`:
- REMOVE the `watiStatus` processor registration
- DO NOT add the new processors yet — Phase 2 owns `flowExecution.processor`, Phase 3 owns `templateSync`, Phase 4 owns `riskScore`. Just leave the queue constants ready.

### 12. Config

Modify `apps/api/src/config.ts`:
- ADD required env: `WABA_POOL_ENCRYPTION_KEY` (must be 64 hex chars = 32 bytes). Validate length in zod schema.
- Add comments for the 4 new feature flag env vars from PRD §16, but mark them OPTIONAL with default `'true'`.

### 13. Deletions

- DELETE `apps/worker/src/processors/watiStatus.processor.ts`
- DELETE `infra/DEPLOYMENT.md` if it exists; ALSO delete root `DEPLOYMENT.md` (verified to exist from `ls -la`). Grep the repo for any references to `run-ts.cjs` or `esbuild` and remove them too (PRD §15).

### 14. Dashboard Onboarding UI

Modify `apps/dashboard/src/pages/OnboardingPage.tsx`:
- Add a step or section that lets the Lynker pick **Pool** or **Manual**.
- Pool mode: just a "Activate WhatsApp" button → POST `/v1/onboarding/complete` with `{ mode: 'pool' }`.
- Manual mode: form fields for `metaPhoneNumberId`, `wabaId`, `metaAccessToken` → POST with `{ mode: 'manual', ... }`.
- On success: show display phone number + redirect to `/dashboard`.
- On `pool_exhausted` failure: show "We're scaling up — our team will reach out within 24h" + the fact that an ops ticket has been created.

Add corresponding entries in `apps/dashboard/src/lib/api.ts` under a new `onboardingApi` namespace.

### 15. Seed Script

**Create `infra/scripts/seed-waba-pool.ts`** per PRD Appendix B. Use placeholder TODOs for the 5 accounts — user will fill these in before running.

```typescript
// REPLACE these with real Meta Cloud API credentials before running.
const POOL_ACCOUNTS = [
  // { phoneNumberId: 'TODO', displayPhone: '+628TODO', wabaId: 'TODO', accessToken: 'TODO' },
];
```

Add an npm script to `package.json` workspace root or `infra/package.json` so `pnpm seed:waba` runs it.

## Quality Gates — Phase 1

Before reporting complete, run and verify:
- `pnpm install`
- `pnpm -w build` (or `pnpm -F @lynkbot/db build && pnpm -F @lynkbot/meta build && pnpm -F api build && pnpm -F dashboard build && pnpm -F worker build`)
- `pnpm -w typecheck`
- `pnpm -w lint`
- `pnpm -F api test` for the new crypto tests

Migration sanity: `cat packages/db/src/migrations/0005_flow_engine.sql | head -50` should match PRD §10.1 verbatim.

## Files Created in Phase 1 (target list)

```
packages/db/src/migrations/0005_flow_engine.sql
packages/db/src/schema/wabaPool.ts
packages/db/src/schema/flowDefinitions.ts
packages/db/src/schema/flowExecutions.ts
packages/db/src/schema/flowTemplates.ts
packages/db/src/schema/buyerBroadcastLog.ts
packages/db/src/schema/tenantRiskScores.ts
apps/api/src/utils/crypto.ts
apps/api/src/utils/__tests__/crypto.test.ts
apps/api/src/services/_meta.helper.ts
apps/api/src/services/wabaPool.service.ts
apps/api/src/middleware/featureGate.ts
apps/api/src/middleware/internalApiKey.ts            (only if not already present)
apps/api/src/routes/internal/wabaPool.ts
apps/api/src/routes/v1/onboarding.ts                 (or modify if present)
infra/scripts/seed-waba-pool.ts
```

## Files Modified in Phase 1 (target list)

```
packages/db/src/schema/tenants.ts        — 4 new columns
packages/db/src/schema/broadcasts.ts     — 2 new columns
packages/db/src/schema/buyers.ts         — 1 new column
packages/db/src/schema/index.ts          — 6 new exports
packages/meta/src/MetaClient.ts          — fromTenant static
packages/shared/src/constants/queues.ts  — −1 +3
apps/api/src/config.ts                   — WABA_POOL_ENCRYPTION_KEY required
apps/api/src/index.ts                    — register internal/waba-pool + v1/onboarding routes
apps/api/src/services/notification.service.ts  — per-tenant MetaClient
apps/api/src/services/conversation.service.ts  — per-tenant MetaClient
apps/api/src/services/checkout.service.ts      — per-tenant MetaClient
apps/api/src/services/payment.service.ts       — per-tenant MetaClient
apps/api/src/services/onboarding.service.ts    — pool / manual paths
apps/worker/src/index.ts                       — remove watiStatus
apps/dashboard/src/pages/OnboardingPage.tsx    — two-path UX
apps/dashboard/src/lib/api.ts                  — onboardingApi namespace
```

## Files Deleted in Phase 1

```
DEPLOYMENT.md                                  (root)
infra/DEPLOYMENT.md                            (if it exists)
apps/worker/src/processors/watiStatus.processor.ts
```

## Reporting Back — End of Phase 1

Append a `## Phase 1 Result` section to this file containing:
- Files created (one line each)
- Files modified (one line each, with brief note of what changed)
- Files deleted (one line each)
- Tests added + passing/failing
- `pnpm typecheck` and `pnpm lint` output (last few lines)
- Anything skipped or unfinished, with reason
- Anything found that affects later phases (write it as a "Phase 2 note" subsection)

Then the orchestrator writes `PHASE_2_HANDOFF.md`.
