# LynkBot UX Rehaul — Execution Plan

**Date Started:** 2026-05-09  
**North Star PRD:** `LynkBot_UX_Rehaul_PRD_v1.0.pdf` (Pages 1–26)  
**Branch:** `feature/ux-rehaul` from `main`  
**Working Directory:** `/Users/storytellers/Documents/Claude Home/Lynkbot`  

---

## Execution Model: Option C (Staggered + Parallel P3 & P4)

```
Phase 1: Onboarding Wizard
        ↓
Phase 2: Template Gallery
        ↓
Phase 3 & 4 (parallel): Scenario Builder + React Flow Editor
        ↓
Phase 5: Integration & Cleanup (waits for both 3 & 4)
```

**Total phases:** 5  
**Sequential dependencies:** Phase 1 → 2 → {3,4} → 5  
**Estimated timeline:** 4–5 working days  

---

## Phase Specs Summary

### Phase 1: First-Time Onboarding Wizard
- **3 new files** + 2 modified
- **Entry trigger:** Tenant has 0 flows AND first visit to `/dashboard/flows`
- **Deterministic:** Business type quiz (3 screens) → template suggestions
- **localStorage:** `lynkbot_onboarding_complete`
- **Handoff:** `PHASE_1_HANDOFF.md` required before commit

### Phase 2: Template Gallery  
- **4 new files** + 2 modified
- **Route:** `/dashboard/automations/new` (new route)
- **Language switch:** ID/EN toggle, stored in localStorage (`lynkbot_gallery_lang`)
- **5 templates:** S1–S5 with preview snippets
- **Entry points:** Onboarding CTA, FlowsListPage button, Sidebar link
- **Handoff:** `PHASE_2_HANDOFF.md` required before commit

### Phase 3: Scenario Builder
- **8 new files** + 3 modified
- **Route:** `/dashboard/automations/new/:templateId`
- **Two-column sticky layout:** Form (left, scrollable) + WhatsApp preview (right, sticky)
- **5 scenarios:** S1 complex, S2–S5 simplified
- **CRITICAL:** Pure TypeScript builder functions (buildS1Flow → buildS5Flow) — **NO LLM**
- **Save paths:** Draft (`flowsApi.create()`) or Activate (`create()` → `updateStatus()`)
- **"Customize in Editor" link appears only AFTER save**
- **Handoff:** `PHASE_3_HANDOFF.md` required before commit

### Phase 4: React Flow Editor Rehaul
- **12 new files** + 4 modified + 1 deleted
- **Library migration:** Drawflow 0.0.60 → React Flow (pinned exact version)
- **New dependencies:** `reactflow@latest`, `elkjs`, `@types/elkjs`
- **Deleted:** `declarations.d.ts` (Drawflow shim)
- **Features:** 17 nodes (8 core + 9 advanced), contextual node picker, auto-layout (ELK.js), keyboard shortcuts, hover-delete edges
- **Handoff:** `PHASE_4_HANDOFF.md` required before commit

### Phase 5: Integration & Cleanup
- **Route cleanup:** Remove `/dashboard/scheduling/setup`, keep file with RETIRED comment
- **Sidebar:** Rename "Flows" → "Automations", add sub-links
- **FlowsListPage:** Add Source column, rename header
- **Code cleanup:** Verify Drawflow removal, package.json updated
- **Quality gates:** typecheck, lint, build, test — ALL PASS
- **Manual smoke test:** Create S1 flow → activate → visible in list
- **Handoff:** `PHASE_5_HANDOFF.md` + PR checklist

---

## Codebase Baseline (Verified from implementation.md)

### Key APIs (apps/dashboard/src/lib/api.ts)
```typescript
flowsApi.create(data)           // POST /flows — used by Scenario Builder
flowsApi.updateStatus(id, 'active' | 'draft' | 'paused')  // PATCH /flows/:id/status
flowsApi.get(id)                // GET /flows/:id — load for editing
```

### Existing Hooks (apps/dashboard/src/hooks/)
- `useStaff()` — GET /scheduling/staff
- `useServices()` — GET /scheduling/services  
- `useIntentPlaybooks()` — implied from PRD, check if exists

### Design System (Tailwind + dark theme)
- WhatsApp preview uses existing `TemplatePreview.tsx` CSS (dark-green bubbles)
- Reuse bubble styling in WhatsAppPreview.tsx, don't reinvent

### FlowDefinition Type (packages/flow-engine/src/types.ts)
- Copied locally to `apps/dashboard/src/types/flow.ts` (dashboard has no workspace dep on flow-engine)
- NodeType union: TRIGGER, SEND_TEXT, SEND_TEMPLATE, WAIT_FOR_REPLY, AGENT, NOTIFY_STAFF, ACTIVATE_PLAYBOOK, ... + advanced nodes
- Edges: source, target, sourcePort (default | true | false | index string)

### Routes to Add (App.tsx)
- `/dashboard/automations` → TemplateGalleryPage
- `/dashboard/automations/new` → TemplateGalleryPage  
- `/dashboard/automations/new/:templateId` → ScenarioBuilderPage
- Keep `/dashboard/flows` alias for backward compat (maps to FlowsListPage)
- Keep `/dashboard/flows/:id/edit` → FlowEditorPage (unchanged)

---

## Architecture Invariants (§10, PRD)

**NEVER VIOLATE:**

1. **No LLM in Scenario Builder** — deterministic builder functions only
2. **No imports from packages/flow-engine in dashboard** — copy types locally
3. **No auto-activation without user intent** — WhatsApp compliance
4. **Keep SchedulingSetupPage.tsx** — retire in place with RETIRED comment
5. **React Flow version pinned** (no ^ or ~) — prevent breaking changes
6. **ELK layout async only** — never block render
7. **TypeScript strict mode throughout** — no any casts except existing codebase
8. **Handoff docs before each commit** — drift prevention

---

## Quality Gates (Phase 5, §8.5 PRD)

Before opening PR, ALL must PASS:
```bash
pnpm -F dashboard typecheck      # Zero errors
pnpm -F dashboard lint           # Zero errors, zero warnings
pnpm -F dashboard build          # Clean build, no unused imports
pnpm -F dashboard test           # All pass (if tests exist)
```

**Manual smoke test:**
1. Navigate to `/dashboard/automations`
2. Create S1 (Book Appointment) flow end-to-end
3. Activate it
4. Verify in flow list with "Source: Scenario Builder"

---

## Handoff Document Template

Every phase MUST write before final commit:

```markdown
# Phase N Handoff — [Name]

> Status: COMPLETE | IN_PROGRESS | BLOCKED
> Agent: [session ID]
> Completed: [date]
> Branch: feature/ux-rehaul
> Last commit: [hash]

## What Was Built
[Files created/modified with line counts]

## What Was Deferred
[If any spec not implemented, reason + next agent approach]

## Known Issues
[Bugs, workarounds, TODOs]

## Dependencies Installed / Removed
[npm package changes]

## Quality Gate Results
- [ ] pnpm -F dashboard typecheck — PASS / FAIL
- [ ] pnpm -F dashboard lint — PASS / FAIL  
- [ ] pnpm -F dashboard build — PASS / FAIL

## Notes for Next Phase
[Context for next agent]
```

---

## Agent Dispatch Order

1. **Phase 1 Agent** (Front-End Dev) — Onboarding Wizard
   - Reads: PRD, this EXECUTION_PLAN.md, implementation.md §2 §4 §12
   - Outputs: PHASE_1_HANDOFF.md
   - Next agent reads: Phase 1 handoff + this plan

2. **Phase 2 Agent** (Front-End Dev) — Template Gallery
   - Reads: PRD, this plan, implementation.md §12, PHASE_1_HANDOFF.md
   - Outputs: PHASE_2_HANDOFF.md

3. **Phase 3 Agent** (Front-End Dev) — Scenario Builder [Parallel with 4]
   - Reads: PRD §6, this plan, PHASE_2_HANDOFF.md
   - Key: Pure builder functions, NO LLM, WhatsApp preview reuses TemplatePreview CSS
   - Outputs: PHASE_3_HANDOFF.md

4. **Phase 4 Agent** (Front-End Dev) — React Flow Editor [Parallel with 3]
   - Reads: PRD §7, this plan, implementation.md §8 §12
   - Key: Library swap (Drawflow → React Flow), ELK.js async layout, 17 nodes
   - Outputs: PHASE_4_HANDOFF.md

5. **Phase 5 Agent** (Lead Architect + QA) — Integration & Cleanup
   - Reads: PRD §8, this plan, PHASE_3_HANDOFF.md + PHASE_4_HANDOFF.md
   - Integrates both, runs quality gates, resolves conflicts
   - Final handoff + PR checklist: PHASE_5_HANDOFF.md

---

## Success Criteria

- [ ] All 5 phases complete with handoff docs
- [ ] Feature branch includes 27 new files + 10 modified + 1 deleted
- [ ] Zero TypeScript errors
- [ ] Smoke test: S1 flow creation → activation → list visible
- [ ] PR opens cleanly to main

**Status: IN_PROGRESS — Phase 1 launching now**
