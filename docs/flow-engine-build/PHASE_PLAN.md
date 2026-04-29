# LynkBot Flow Engine v2.1 — Phased Build Plan

> **North Star Document**: `LynkBot_Flow_Engine_PRD_v2.1.md` (project root).
> Every phase MUST treat the PRD as authoritative. When this plan and the PRD disagree,
> the PRD wins.

## Build Philosophy

This build uses **agentic scaffolding**: each phase is executed by a fresh sub-agent
that picks up from the prior phase's handoff document. Each agent reads:

1. The PRD (`LynkBot_Flow_Engine_PRD_v2.1.md`) — north star
2. This plan (`PHASE_PLAN.md`) — orchestration overview
3. Its own handoff doc (`PHASE_N_HANDOFF.md`) — concrete deliverables for that phase
4. Prior handoff docs — context on what's already built

After each phase, the orchestrator validates the diff and writes the next handoff.

## Branch + Push Strategy

- Working branch: `claude/elegant-brattain-b5512a` (worktree-auto-named)
- DO NOT push to `main`. Final push goes to the feature branch above; user opens the PR.
- Each phase produces one commit (or a small fan of commits) so progress is reviewable.

## Phase Map

| Phase | Scope | Files | Depends on |
|-------|-------|-------|-----------|
| **1** | Foundation: migration `0005`, 6 new schemas, modify 3 existing schemas, `MetaClient.fromTenant`, per-tenant refactor of 4 services, `featureGate` middleware, queues cleanup, delete WATI stub + DEPLOYMENT.md, AES-256 crypto util, WABA pool table + service + onboarding two-path UX | ~25 | — |
| **2** | Flow Engine package: `packages/flow-engine` (engine, evaluators, 13 node processors), webhook button-trigger routing, flow execution processor, cron seeding endpoint, unit tests | ~22 | Phase 1 |
| **3** | Template Studio: `templateStudio.service`, `/v1/flow-templates` routes, webhook template-status handler, `templateSync.processor` | ~6 | Phase 1 |
| **4** | Re-engagement + Risk Scoring: time-trigger cron evaluator, `riskScore.service` + routes, broadcast extension (`flowId`, `riskScoreAtSend`), risk gates on activation/broadcast, `riskScore.processor` | ~7 | Phase 2 |
| **5** | AI flow generation + Dashboard UI: `/v1/ai/generate-flow` + `/v1/ai/modify-flow`, Drawflow canvas, FlowsListPage, FlowEditorPage + components, Templates pages + components, `RiskScoreGauge`, sidebar/route updates, API client extensions | ~20 | Phases 1–4 |
| **6** | Tests + cleanup: integration tests (api routes), worker processor tests, E2E tests, lint, type check, final docs polish | ~12 | All prior |

## Compliance Invariants (Hard Rules — Enforced as Code)

These are pulled directly from PRD §4 and §17. Every phase agent must respect them:

1. **No freeform text outside 24h window** — `MetaClient.sendText()` already throws; do not catch-and-swallow.
2. **No unofficial WA libraries** — `.eslintrc.js` enforces; do not bypass.
3. **`doNotContact=true` buyers excluded** from every outbound path — including inside flows.
4. **STOP/BERHENTI** sets `doNotContact=true` AND cancels all active `flow_executions`.
5. **Same template to same buyer max 1× per 7 days** — `CooldownChecker` in flow-engine.
6. **Max 1000 marketing templates per WABA per hour** — Redis counter in flow broadcast worker.
7. **Interactive Quick-Reply buttons required** on every broadcast template used as a flow trigger.
8. **Minimum 500ms between consecutive outbound messages** to the same number.
9. **Per-tenant `MetaClient`** — never read `config.META_ACCESS_TOKEN` in flow-related code.
10. **AI-generated flows always start as `draft`** — never auto-activate.
11. **Risk score > 80 blocks activation/broadcast** — non-overridable.
12. **Max 2 template appeals** — block the API call after `appealCount >= 2`.

## Quality Gates Per Phase

Each phase agent must, before reporting complete:

- `pnpm install` cleanly with no new peer-dep warnings
- `pnpm -w build` (or equivalent) compiles all touched packages
- `pnpm -w typecheck` passes for all touched packages
- `pnpm -w lint` passes (no eslint errors in touched files)
- New tests added in the phase pass: `pnpm -F <package> test`
- Phase-end: append a "Done / Pending / Followups" section to its handoff doc

## Definition of Done — End of Phase 6

- All routes in PRD §11 exist and respond
- Migration `0005` applies cleanly on a fresh database
- New onboarding flow assigns from WABA pool OR accepts manual Meta credentials
- Webhook routes button payloads to FlowEngine
- AI flow generation returns valid (or lenient-with-`validationErrors[]`) FlowDefinition
- Risk score gates enforce > 80 block
- Cooldown enforced
- All three "non-negotiable" tests in PRD §14.5 pass
- `infra/DEPLOYMENT.md` (or root `DEPLOYMENT.md`) deleted; Railway deployment doc written
- `apps/worker/src/processors/watiStatus.processor.ts` deleted
- `QUEUES.WATI_STATUS` removed from `packages/shared/src/constants/queues.ts`
- 3 new queues added: `FLOW_EXECUTION`, `TEMPLATE_SYNC`, `RISK_SCORE`
- Branch pushed; Railway env-var checklist provided to user

## Onboarding Decision (User Clarification)

User confirmed: **DB has no real tenants yet**. Onboarding therefore needs two paths:

- **Path A — LynkBot Pool (default)**: Onboarding service picks an `available` row from `waba_pool`, assigns it to the new tenant. Lynker provides nothing Meta-related.
- **Path B — Bring Your Own WABA**: Lynker enters `metaPhoneNumberId`, `wabaId`, `metaAccessToken` (System User token) directly in onboarding. Stored encrypted on `tenants` row.

The dashboard onboarding wizard surfaces both paths. Phase 1 implements both backend + frontend.

## Bilingual AI Prompt (User Clarification)

User confirmed bilingual: the **system prompt** is bilingual (English structure + Indonesian intent context); generated **message bodies** in flows are Indonesian (Bahasa Indonesia).

## Drawflow Version (User Clarification)

User confirmed: latest available Drawflow npm version (currently `0.0.60` family).
Pin it in `apps/dashboard/package.json` to avoid silent upgrades.

## Test Coverage Bar (User Clarification)

User confirmed: **full PRD §14 coverage**, not just §14.5 non-negotiables.

---

*This plan is rebuildable from the PRD. If lost, regenerate from PRD §15 (file manifest)
and §17 (do/don't cheatsheet).*
