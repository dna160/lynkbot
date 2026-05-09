# Phase 4 Handoff — React Flow Editor Rehaul

## Status: COMPLETE

## Summary

Replaced the 1858-line Drawflow-based `FlowEditorPage.tsx` with a fully
component-based React Flow (`@xyflow/react@12.6.4`) implementation.
The new editor is split into 11 focused files + 1 handoff doc.

---

## Dependencies Added

| Package | Version | Purpose |
|---|---|---|
| `@xyflow/react` | 12.6.4 (exact) | React Flow canvas |
| `elkjs` | 0.9.3 | Auto-layout algorithm |

No `@types/elkjs` needed — elkjs ships its own `.d.ts` via `"types": "lib/main"`.

---

## Files

### New (11 code files)

| File | Purpose |
|---|---|
| `src/lib/flowConvert.ts` | FlowDefinition ↔ React Flow format conversion |
| `src/pages/Flows/components/nodes/nodeConfig.ts` | PALETTE_NODES, preview text, handle config |
| `src/pages/Flows/components/nodes/FlowNode.tsx` | Custom RF node component (all 14 types) |
| `src/pages/Flows/components/CustomEdge.tsx` | Hover-delete edge with `EdgeLabelRenderer` |
| `src/pages/Flows/components/VariablePicker.tsx` | Variable chip picker (extracted) |
| `src/pages/Flows/components/MessageEditor.tsx` | Textarea + variable insertion (extracted) |
| `src/pages/Flows/components/NodeConfigEditor.tsx` | All node config forms (extracted) |
| `src/pages/Flows/components/NodePickerPopup.tsx` | Contextual node type picker |
| `src/pages/Flows/components/FlowCanvas.tsx` | ReactFlow canvas wrapper |
| `src/hooks/useFlowEditor.ts` | Editor state (nodes, edges, selection, add/delete) |
| `src/hooks/useELKLayout.ts` | ELK layered auto-layout (async) |

### Modified (1)

| File | Change |
|---|---|
| `src/pages/Flows/FlowEditorPage.tsx` | Full replacement — React Flow, preserved AI panel and save/load logic |

### Deleted (1)

| File | Reason |
|---|---|
| `src/declarations.d.ts` | Drawflow type shim, no longer needed |

---

## Architecture Notes

### FlowDefinition ↔ React Flow conversion
- `toRFNodes(nodes)` assigns cascade positions (y += 130 per node) when no layout data exists
- `fromRFNodes(rfNodes)` strips position data back to `FlowNode`
- `sourcePort` in `FlowEdge` maps to `sourceHandle` in RF edge
- The TRIGGER node's `triggerType` is kept in sync with the top-bar select via `useFlowEditor`

### Handle IDs
- Single-output nodes: one `Handle id="output"` at bottom
- IF_CONDITION: two handles `id="true"` (left 28%) and `id="false"` (right 72%)
- KEYWORD_ROUTER: two handles `id="0"` (left 28%) and `id="1"` (right 72%)
- END_FLOW, START_SCHEDULING, ACTIVATE_PLAYBOOK: no source handles

### Custom edge
- `CustomEdge` (type `'deletable'`) renders a transparent 16px hit-area over the
  bezier path. On hover it changes color and shows a red `×` delete button via
  `EdgeLabelRenderer`. Clicking the `×` calls `deleteElements`.

### Auto-layout
- `useELKLayout.autoLayout(rfNodes, rfEdges)` calls `elk.bundled.js` (no web worker)
- Algorithm: `elk.algorithm: layered`, direction: `DOWN`
- Result is applied by replacing `position` on each node via `setRFNodes`

### Keyboard
- React Flow's `deleteKeyCode="Delete"` prop handles node/edge deletion natively.
  Focus must be on the canvas (not an input) for this to fire.

### "+ Add step" flow
1. `FlowNode` renders a dashed "＋ Add step" button for single-output nodes
2. On click it calls `onAddStep(nodeId, screenX, screenY)` from `FlowEditorPage`
3. `FlowEditorPage` stores picker state and renders `NodePickerPopup`
4. Picking a type calls `addNode(type, sourceNodeId)` in `useFlowEditor`
5. `addNode` creates the node below the source and auto-creates a `deletable` edge

---

## Preserved Features

- All 14 node types with full config forms
- AI Generate and AI Modify panel
- Save / Create Draft / Activate / Pause top-bar actions
- Trigger type selector synced with TRIGGER node config
- Flow name editable inline
- Status badge (draft / active / paused / archived)
- Variable picker with Buyer, Order, Conversation, Custom variable groups

---

## TypeScript

`tsc --noEmit` passes with zero errors. `vite build` completes clean (warnings are
pre-existing chunk-size and dynamic-import notices unrelated to Phase 4).

---

## Known Limitations / Phase 5 Follow-up

- Drag-from-palette is not implemented (click-to-add still works); Phase 5 can add
  `onDragStart` + canvas `onDrop` if needed
- Node positions from `toRFNodes` are cascade-only; auto-layout (ELK button) applies
  proper DAG layout on demand
- MiniMap node colors cover the 7 most common types; others fall back to `#334155`
