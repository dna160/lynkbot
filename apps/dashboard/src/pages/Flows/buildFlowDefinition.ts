/**
 * @CLAUDE_CONTEXT
 * File    : src/pages/Flows/buildFlowDefinition.ts
 * Role    : Pure function — wizard state → FlowDefinition (v3 Phase 4)
 *           No side effects. No API calls. No React.
 *           All node types produced here are valid engine node types:
 *             TRIGGER_INBOUND_KEYWORD, TRIGGER_ORDER_EVENT, TRIGGER_TIME_SINCE_EVENT,
 *             COLLECT_INFO, START_SCHEDULING, SEND_TEXT, SEND_TEMPLATE, DELAY, END_FLOW
 *           NEVER generates TRIGGER or AGENT node types (those silently fail in engine).
 */

import type { FlowDefinition, FlowNode, FlowEdge, NodeType } from '@/types/flow';

// ── Wizard state shape ─────────────────────────────────────────────────────────

export type WizardPurpose = 'qualify' | 'scheduling' | 'followup';

export type WizardTriggerType = 'inbound_keyword' | 'order_event' | 'time_since_event';

export type OrderEventType = 'payment_confirmed' | 'shipped' | 'delivered' | 'payment_failed';

export interface CollectInfoQuestion {
  id: string;
  promptText: string;
  variableName: string;
  type: 'text' | 'choice';
  choices?: string[];
  required: boolean;
}

export interface WizardState {
  name: string;
  purpose: WizardPurpose;

  // Step 2: Trigger config
  triggerType: WizardTriggerType;
  keywords: string[];                       // for inbound_keyword
  orderEvent?: OrderEventType;             // for order_event
  timeSinceEvent?: {
    event: string;
    duration: number;
    unit: 'hours' | 'days';
  };

  // Step 3: Qualifying questions
  qualifyingQuestions: {
    enabled: boolean;
    questions: CollectInfoQuestion[];
  };

  // Step 4: Main action (varies by purpose)
  qualify: {
    outcomeMessage: string;
  };
  scheduling: {
    serviceId?: string;
    assignedStaffId?: string;
    confirmationModel?: 'staff_confirm' | 'instant';
    introMessage?: string;
    consultationType?: string;
  };
  followup: {
    templateName?: string;
    message?: string;
    delayMs?: number;
  };
}

// ── Helper functions ────────────────────────────────────────────────────────────

function node(
  id: string,
  type: NodeType,
  config: Record<string, unknown>,
  label?: string,
): FlowNode {
  return { id, type, label, config };
}

function edge(id: string, source: string, target: string, sourcePort?: string): FlowEdge {
  return { id, source, target, ...(sourcePort && { sourcePort }) };
}

function buildTriggerConfig(state: WizardState): Record<string, unknown> {
  if (state.triggerType === 'inbound_keyword') {
    return { keywords: state.keywords.filter(Boolean) };
  }
  if (state.triggerType === 'order_event') {
    return { orderEvent: state.orderEvent ?? 'payment_confirmed' };
  }
  if (state.triggerType === 'time_since_event' && state.timeSinceEvent) {
    return {
      event: state.timeSinceEvent.event,
      duration: state.timeSinceEvent.duration,
      unit: state.timeSinceEvent.unit,
    };
  }
  return {};
}

// ── Main builder ────────────────────────────────────────────────────────────────

export function buildFlowDefinition(state: WizardState): FlowDefinition {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // ── 1. Trigger node ──────────────────────────────────────────────────────────
  const triggerNodeId = 'trigger_1';

  // Use the canonical 'TRIGGER' node type so that:
  //  1. The flow canvas editor can render and edit the node (it only knows 'TRIGGER')
  //  2. The engine's trigger-node lookup handles 'TRIGGER' correctly
  // The trigger BEHAVIOUR (keyword / order_event / time_based) is stored in:
  //  - flowDefinitions.triggerType  (DB column — engine queries this)
  //  - flowDefinitions.triggerConfig (DB column — engine reads keywords / orderEvent here)
  // The node.config carries the same config as a convenience for the canvas display.
  if (state.triggerType === 'inbound_keyword') {
    nodes.push(node(
      triggerNodeId,
      'TRIGGER',
      { triggerType: 'inbound_keyword', keywords: state.keywords.filter(Boolean) },
      'Keyword Trigger',
    ));
  } else if (state.triggerType === 'order_event') {
    nodes.push(node(
      triggerNodeId,
      'TRIGGER',
      { triggerType: 'order_event', orderEvent: state.orderEvent ?? 'payment_confirmed' },
      'Order Event Trigger',
    ));
  } else if (state.triggerType === 'time_since_event' && state.timeSinceEvent) {
    nodes.push(node(
      triggerNodeId,
      'TRIGGER',
      {
        triggerType: 'time_based',
        event: state.timeSinceEvent.event,
        duration: state.timeSinceEvent.duration,
        unit: state.timeSinceEvent.unit,
      },
      'Time Trigger',
    ));
  }

  let prevNodeId = triggerNodeId;
  let nodeCounter = 2;

  // ── 2. Qualifying questions (COLLECT_INFO node) ───────────────────────────────
  if (
    state.qualifyingQuestions.enabled &&
    state.qualifyingQuestions.questions.length > 0
  ) {
    const collectNodeId = `collect_info_${nodeCounter++}`;
    nodes.push(node(
      collectNodeId,
      'COLLECT_INFO',
      {
        questions: state.qualifyingQuestions.questions,
        onComplete: 'continue',
      },
      'Qualifying Questions',
    ));
    edges.push(edge(`e_${prevNodeId}_${collectNodeId}`, prevNodeId, collectNodeId));
    prevNodeId = collectNodeId;
  }

  // ── 3. Main action node ───────────────────────────────────────────────────────
  if (state.purpose === 'scheduling') {
    const schedNodeId = `scheduling_${nodeCounter++}`;
    nodes.push(node(
      schedNodeId,
      'START_SCHEDULING',
      {
        serviceId: state.scheduling.serviceId,
        assignedStaffId: state.scheduling.assignedStaffId,
        confirmationModel: state.scheduling.confirmationModel ?? 'staff_confirm',
        introMessage: state.scheduling.introMessage ?? 'Let me help you book an appointment.',
        consultationType: state.scheduling.consultationType ?? 'Consultation',
      },
      'Schedule Appointment',
    ));
    edges.push(edge(`e_${prevNodeId}_${schedNodeId}`, prevNodeId, schedNodeId));
    prevNodeId = schedNodeId;
  }

  if (state.purpose === 'qualify') {
    const outcomeNodeId = `send_outcome_${nodeCounter++}`;
    nodes.push(node(
      outcomeNodeId,
      'SEND_TEXT',
      { message: state.qualify.outcomeMessage || "Thanks for your interest! We'll be in touch soon." },
      'Outcome Message',
    ));
    edges.push(edge(`e_${prevNodeId}_${outcomeNodeId}`, prevNodeId, outcomeNodeId));
    prevNodeId = outcomeNodeId;
  }

  if (state.purpose === 'followup') {
    if (state.followup.templateName) {
      // Template-based follow-up
      const templateNodeId = `send_template_${nodeCounter++}`;
      nodes.push(node(
        templateNodeId,
        'SEND_TEMPLATE',
        { templateName: state.followup.templateName },
        'Send Template',
      ));
      edges.push(edge(`e_${prevNodeId}_${templateNodeId}`, prevNodeId, templateNodeId));
      prevNodeId = templateNodeId;
    } else {
      // Text-based follow-up
      const textNodeId = `send_text_${nodeCounter++}`;
      nodes.push(node(
        textNodeId,
        'SEND_TEXT',
        { message: state.followup.message || 'Thanks for your order! Let us know if you need anything.' },
        'Follow-Up Message',
      ));
      edges.push(edge(`e_${prevNodeId}_${textNodeId}`, prevNodeId, textNodeId));
      prevNodeId = textNodeId;
    }

    // Optional delay
    if (state.followup.delayMs && state.followup.delayMs > 0) {
      const delayNodeId = `delay_${nodeCounter++}`;
      nodes.push(node(
        delayNodeId,
        'DELAY',
        { delayMs: state.followup.delayMs },
        'Wait',
      ));
      edges.push(edge(`e_${prevNodeId}_${delayNodeId}`, prevNodeId, delayNodeId));
      prevNodeId = delayNodeId;
    }
  }

  // ── 4. END_FLOW node ──────────────────────────────────────────────────────────
  const endNodeId = `end_${nodeCounter}`;
  nodes.push(node(endNodeId, 'END_FLOW', { reason: 'completed' }, 'End'));
  edges.push(edge(`e_${prevNodeId}_${endNodeId}`, prevNodeId, endNodeId));

  return {
    nodes,
    edges,
    // These fields are set by the API on create — wizard provides name + triggerConfig only
    id: '',
    tenantId: '',
    name: state.name,
    triggerConfig: buildTriggerConfig(state),
    status: 'draft',
    aiGenerated: false,
    version: 1,
  } as unknown as FlowDefinition;
}

// API trigger type mapping — time_since_event maps to 'time_based' per engine convention
export function buildApiTriggerType(state: WizardState): string {
  if (state.triggerType === 'inbound_keyword') return 'inbound_keyword';
  if (state.triggerType === 'order_event') return 'order_event';
  if (state.triggerType === 'time_since_event') return 'time_based';
  return 'inbound_keyword';
}
