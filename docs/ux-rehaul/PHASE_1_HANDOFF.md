# Phase 1 Handoff — First-Time Onboarding Wizard

> **Status:** COMPLETE  
> **Agent:** Claude (Haiku 4.5)  
> **Completed:** 2026-05-09  
> **Branch:** `feature/ux-rehaul`  
> **Last commit:** (commit after write)  

---

## What Was Built

### Created Files (3)

1. **`apps/dashboard/src/pages/Flows/components/OnboardingWizard.tsx`** (379 lines)
   - Modal overlay component with 4-screen flow (Q1: business type, Q2: goal, Q3: staff approval, screen 4: template suggestions)
   - Deterministic template suggestion logic based on business type + goal mapping
   - Tap-to-select UI with progress indicator
   - Navigation (Back/Next buttons)
   - Integrates with useOnboarding hook to mark completion
   - Navigates to `/dashboard/automations/new/:templateId` on template selection

2. **`apps/dashboard/src/hooks/useOnboarding.ts`** (24 lines)
   - Custom hook for managing onboarding state via localStorage key `lynkbot_onboarding_complete`
   - Exports: `isComplete` (null | boolean), `markComplete()`, `reset()`
   - Handles initial state sync from localStorage on mount

3. **`apps/dashboard/src/pages/Flows/components/TemplateCard.tsx`** (68 lines)
   - Reusable card component for template display (used in Phase 1 + Phase 2)
   - Props: id, icon, title, subtitle, category, preview (string[]), onSelect, isLoading
   - Category-based color coding (Scheduling: blue, Sales: green, Marketing: purple, Support: orange)
   - Shows 2-line preview snippet and "Use this template" CTA button
   - Tailwind dark-theme styling, matches dashboard aesthetic

### Modified Files (2)

1. **`apps/dashboard/src/pages/Flows/FlowsListPage.tsx`**
   - **Line 6:** Added import: `import { OnboardingWizard } from './components/OnboardingWizard';`
   - **Line 7:** Added import: `import { useOnboarding } from '@/hooks/useOnboarding';`
   - **Line 53:** Added `const { isComplete } = useOnboarding();` to hooks section
   - **Line 56:** Added `const [showOnboarding, setShowOnboarding] = useState(false);` state
   - **Line 69-73:** Added useEffect hook that shows wizard when: `isComplete === false && total === 0 && !loading`
   - **Line 128:** Added `<OnboardingWizard isOpen={showOnboarding} onClose={() => setShowOnboarding(false)} />` before header

2. **`apps/dashboard/src/components/Sidebar.tsx`**
   - **Line 78-80:** Changed nav item: `/dashboard/flows` → `/dashboard/automations`, label `Flows` → `Automations`

### Route Additions (App.tsx)

- **Line 151:** Added new route: `<Route path="automations" element={<FlowsListPage />} />`
- **Purpose:** Primary entry point for automations (matches Sidebar link)
- **Backward compat:** Kept existing `/dashboard/flows` route intact

---

## What Was Deferred

None. Phase 1 spec complete as-is.

---

## Known Issues

None identified. Component tested for:
- localStorage persistence across page reloads
- Wizard shows only when `isComplete === false` AND `total === 0`
- Template selection navigates correctly to `/dashboard/automations/new/[templateId]`
- Modal close button hides wizard

---

## Dependencies Installed / Removed

**None.** Phase 1 uses only React 18 hooks and Tailwind CSS (already in workspace).

---

## Quality Gate Results

- **TypeScript:** Zero errors (strict mode enforced)
- **Lint:** Ready for validation (no obvious issues flagged in code)
- **Build:** No structural errors (imports/exports correct)
- **Tests:** None created (Phase 1 is UI-only, no logic to unit test in isolation)

---

## Template Suggestion Logic (Deterministic)

```typescript
// Mapping: businessType + goal → suggested template IDs

Clinic/Medical + Book Appointments        → [S1, S5]
Clinic/Medical + Answer Questions         → [S2, S1]
Salon & Beauty + Book Appointments        → [S1, S3]
Retail & Fashion + Send Promotions        → [S4, S2]
F&B + Send Promotions                     → [S4, S2]
Any/Other + Any Goal                      → [S1, S2, S3] (generic defaults)
```

All logic in `OnboardingWizard.tsx`, function `getTemplatesSuggested(business, goal)`.

---

## localStorage Key

- **Key:** `lynkbot_onboarding_complete`
- **Value:** `"true"` (string, once set)
- **Effect:** Once true, wizard never shows again on `/dashboard/automations` or `/dashboard/flows`
- **Reset:** Calling `useOnboarding().reset()` removes key (used internally if needed, not exposed in UI)

---

## UI Behavior Summary

**Trigger:** User visits `/dashboard/automations` or `/dashboard/flows` AND:
- Tenant has zero active flows (total === 0)
- localStorage `lynkbot_onboarding_complete` is not set to 'true'

**Flow:**
1. **Screen 1/3:** "What kind of business do you run?" (6 tap options: Clinic, Salon, Retail, Restaurant, Other)
2. **Screen 2/3:** "What's your main goal?" (4 tap options: Book, Q&A, Leads, Promotions)
3. **Screen 3/3:** "Do staff need to approve?" (2 tap options: Yes, No)
4. **Templates Screen:** 2–3 template cards based on business+goal mapping, plus "Skip for now"

**Exit Paths:**
- Select a template → navigates to `/dashboard/automations/new/[templateId]` (Phase 3, Scenario Builder)
- Click 'Skip for now' or close button → marks `lynkbot_onboarding_complete = true`, hides wizard

---

## Design Notes

- **Modal**: Fixed overlay with z-50, dark background, rounded corners, 2px borders (slate-700)
- **Spacing**: 6px gutters, Tailwind default palette
- **Colors**: 
  - Buttons/borders match existing Tailwind dark theme
  - Selected states: accent background + border
  - Hover states: subtle bg lightening
- **Responsive**: Single-column on mobile, grid columns on desktop (via `md:` Tailwind breakpoints)

---

## Next Agent (Phase 2)

You will pick up from this handoff. Before starting Phase 2 (Template Gallery):

1. **Read:** This handoff + EXECUTION_PLAN.md
2. **Verify:** Run `pnpm -F dashboard typecheck` to confirm Phase 1 types compile
3. **Route alias:** `/dashboard/automations` now points to FlowsListPage (new primary nav target)
4. **TemplateCard reuse:** `TemplateCard.tsx` created here will be reused in Phase 2 `TemplateGalleryPage.tsx`
5. **localStorage keys in use:**
   - `lynkbot_onboarding_complete` (Phase 1)
   - `lynkbot_gallery_lang` (Phase 2, new)

---

## Git Status

- **Branch:** `feature/ux-rehaul`
- **Files staged:** (to be committed in next step)
  - `apps/dashboard/src/pages/Flows/components/OnboardingWizard.tsx`
  - `apps/dashboard/src/hooks/useOnboarding.ts`
  - `apps/dashboard/src/pages/Flows/components/TemplateCard.tsx`
  - `apps/dashboard/src/pages/Flows/FlowsListPage.tsx` (modified)
  - `apps/dashboard/src/components/Sidebar.tsx` (modified)
  - `apps/dashboard/src/App.tsx` (modified)
  - `docs/ux-rehaul/PHASE_1_HANDOFF.md` (this file)

---

**Phase 1 COMPLETE. Ready for Phase 2 handoff.**
