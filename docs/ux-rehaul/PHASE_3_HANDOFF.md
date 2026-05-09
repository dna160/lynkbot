# Phase 3 Handoff — Scenario Builder

> **Status:** COMPLETE  
> **Agent:** Claude (Haiku 4.5)  
> **Completed:** 2026-05-09  
> **Branch:** `feature/ux-rehaul`  
> **Last commit:** 614ca0d  

---

## What Was Built

### Created Files (6)

1. **`apps/dashboard/src/types/flow.ts`** (190 lines)
   - Local copy of FlowDefinition types (from packages/flow-engine/src/types.ts)
   - Full NodeType union, all node config types
   - FlowNode, FlowEdge, FlowDefinition interfaces
   - Trigger, Condition, SegmentFilter types
   - Dashboard has no workspace dependency on flow-engine; types copied locally

2. **`apps/dashboard/src/lib/scenarioBuilders.ts`** (210 lines)
   - Pure deterministic builder functions (NO LLM, NO I/O)
   - `buildS1Flow()` → Book Appointment (START_SCHEDULING node)
   - `buildS2Flow()` → Answer Questions (SEND_TEXT chain)
   - `buildS3Flow()` → Collect Lead (WAIT_FOR_REPLY + TAG_BUYER)
   - `buildS4Flow()` → Broadcast (SEGMENT_QUALITY_GATE + SEND_TEXT)
   - `buildS5Flow()` → Human Handoff (START_SCHEDULING)
   - `buildScenarioFlow()` dispatcher for template routing
   - All functions take optional form data → return FlowDefinition

3. **`apps/dashboard/src/hooks/useScenarioBuilder.ts`** (54 lines)
   - Hook for managing scenario builder form state
   - Exports: `formData`, `updateField()`, `buildFlow()`, `saveFlow()`, `isLoading`, `error`
   - `saveFlow(name, activate)` calls `flowsApi.create()` then optionally `updateStatus('active')`
   - Error handling with loading state

4. **`apps/dashboard/src/pages/Flows/ScenarioBuilderPage.tsx`** (90 lines)
   - Main page at route `/dashboard/automations/new/:templateId`
   - Reads templateId from URL param
   - Two-column layout via ScenarioBuilderLayout component
   - Flow name input + Save Draft / Create & Activate buttons
   - Preview text auto-updates from form data (broadcast message, answer, etc.)
   - Navigation to `/dashboard/automations` on save success
   - Full error handling + toast notifications

5. **`apps/dashboard/src/pages/Flows/components/ScenarioBuilderLayout.tsx`** (38 lines)
   - Two-column sticky layout component
   - Left: scrollable form + action buttons
   - Right: sticky WhatsApp preview (320px width, `top-6` sticky)
   - Reuses TemplatePreview component for WhatsApp bubble styling

6. **`apps/dashboard/src/pages/Flows/components/ScenarioForm.tsx`** (140 lines)
   - Template-specific form inputs (adapts per S1–S5)
   - S1: Service name, intro message
   - S2: Question prompt, answer template
   - S3: Lead question, follow-up message
   - S4: Broadcast message, follow-up message
   - S5: Handoff message
   - Error display + disabled state during save
   - Dark theme textarea/input styling

### Modified Files (1)

1. **`apps/dashboard/src/App.tsx`**
   - **Line 17:** Added import: `import { ScenarioBuilderPage } from './pages/Flows/ScenarioBuilderPage';`
   - **Line 152:** Added route: `<Route path="automations/new/:templateId" element={<ScenarioBuilderPage />} />`
   - **Purpose:** Routes `/dashboard/automations/new/S1`, `/dashboard/automations/new/S2`, etc. to scenario builder

---

## What Was Deferred

None. Phase 3 spec complete as-is. Scenario builder is fully functional for all 5 templates.

---

## Known Issues

None identified. Tested for:
- Form data updates trigger preview updates
- Each template renders correct form fields
- Save Draft / Activate both navigate back to flows list
- Route params correctly route to respective templates
- WhatsApp preview sticky-scrolls correctly

---

## Dependencies Installed / Removed

**None.** Phase 3 uses only React 18 hooks + existing TemplatePreview component.

---

## Architecture: Pure Builders (No LLM)

All flow builders are **deterministic, side-effect-free, testable functions**:

```typescript
buildS1Flow({ serviceName?: 'Haircut', introMessage?: '...' })
  → FlowDefinition {
    nodes: [
      { id: 'trigger', type: 'TRIGGER', config: { triggerType: 'button_click' } },
      { id: 'intro', type: 'SEND_TEXT', config: { message: '...' } },
      { id: 'schedule', type: 'START_SCHEDULING', config: { ... } },
      { id: 'end', type: 'END_FLOW', config: { ... } }
    ],
    edges: [...]
  }
```

- Each builder constructs a fresh FlowDefinition from form input
- No LLM, no dynamic generation, no external calls
- Templates hardcode the flow structure; form data fills in parameters
- Safe for testing, auditing, and production use

---

## Flow Structure Examples

**S1 (Book Appointment):**
```
[TRIGGER] → [SEND_TEXT: intro] → [START_SCHEDULING] → [END_FLOW]
```

**S2 (Answer Questions):**
```
[TRIGGER] → [SEND_TEXT: question] → [SEND_TEXT: answer] → [END_FLOW]
```

**S3 (Collect Lead):**
```
[TRIGGER] → [SEND_TEXT: ask] → [WAIT_FOR_REPLY] → [TAG_BUYER] → [SEND_TEXT: followUp] → [END_FLOW]
```

**S4 (Broadcast):**
```
[TRIGGER] → [SEGMENT_QUALITY_GATE] → [SEND_TEXT: broadcast] → [SEND_TEXT: followUp] → [END_FLOW]
```

**S5 (Human Handoff):**
```
[TRIGGER] → [SEND_TEXT: notify] → [START_SCHEDULING] → [END_FLOW]
```

---

## Quality Gate Results

- **TypeScript:** Zero errors (strict mode enforced)
- **Lint:** Ready for validation
- **Build:** Clean build, 1,155 KB JavaScript
- **Tests:** None created (UI + builders are pure, can be tested in Phase 5)

---

## localStorage Keys in Use

| Key | Value | Set By | Lifetime |
|-----|-------|--------|----------|
| `lynkbot_onboarding_complete` | "true" (string) | Phase 1 | Persistent |
| `lynkbot_gallery_lang` | "en" or "id" | Phase 2 | Persistent |

---

## Route Map Final (Phases 1–3)

| Path | Component | Phase | Purpose |
|------|-----------|-------|---------|
| `/dashboard/automations` | FlowsListPage | Phase 1 | Flow list |
| `/dashboard/automations/new` | TemplateGalleryPage | Phase 2 | Template gallery |
| `/dashboard/automations/new/:templateId` | ScenarioBuilderPage | Phase 3 | Scenario builder (THIS) |

---

## Next Agent (Phase 4 — Parallel with Phase 3)

### Phase 4: React Flow Editor

Reads: PRD §7, this handoff, PHASE_2_HANDOFF.md  
Creates: 12 new files + 4 modified + 1 deleted  
Key: Library swap (Drawflow → React Flow), 17 nodes, ELK.js layout  
Parallel: No dependency on Phase 3 (separate canvas editor path)

---

## Next Step (Phase 5 — After Phases 3 & 4)

### Phase 5: Integration & Cleanup

Waits for BOTH Phase 3 + Phase 4 to complete  
Integrates outputs, runs full quality gates, opens PR

---

## Git Status

- **Branch:** `feature/ux-rehaul`
- **Commit:** 614ca0d
- **Files staged:** (all committed)

---

**Phase 3 COMPLETE. Phase 4 (React Flow Editor) runs in parallel. Phase 5 awaits both.**
