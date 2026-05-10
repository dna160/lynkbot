/**
 * @CLAUDE_CONTEXT
 * File    : src/lib/scenarioBuilders.ts
 * Role    : Deterministic flow builders for S1-S6 scenarios (v3 Phase 4)
 *           Pure functions: (form data) → FlowDefinition
 *           NO LLM, NO external I/O
 *
 * v3 changes:
 *   - All keyword-triggered flows now use TRIGGER_INBOUND_KEYWORD (not TRIGGER)
 *   - S3 (lead capture) uses COLLECT_INFO instead of SEND_TEXT + WAIT_FOR_REPLY chains
 *   - S6 (order follow-up) added — TRIGGER_ORDER_EVENT + SEND_TEXT
 *   - S4 (broadcast) keeps TRIGGER as it uses broadcastToSegment — not buyer-reply driven
 */

import { FlowDefinition, FlowNode, FlowEdge, NodeType } from '@/types/flow';

function createNode(
  id: string,
  type: NodeType,
  config: Record<string, unknown>,
  label?: string,
): FlowNode {
  return { id, type, label, config };
}

function createEdge(id: string, source: string, target: string, sourcePort?: string): FlowEdge {
  return { id, source, target, ...(sourcePort && { sourcePort }) };
}

// ── S1: Book Appointment ────────────────────────────────────────────────────────

export interface S1FormData {
  triggerType?: 'button_click' | 'inbound_keyword';
  triggerKeywords?: string[];
  triggerButtonPayload?: string;
  serviceName?: string;
  introMessage?: string;
  consultationType?: string;
}

export function buildS1Flow(data: S1FormData): FlowDefinition {
  const triggerType = data.triggerType ?? 'inbound_keyword';
  if (triggerType === 'button_click') {
    // Button-triggered flows keep legacy TRIGGER node since engine routes them
    // via handleButtonTrigger which already handles TRIGGER node type.
    const triggerConfig: Record<string, unknown> = {
      triggerType: 'button_click',
      buttonPayloadPrefix: data.triggerButtonPayload ?? 'book_',
    };
    const nodes: FlowNode[] = [
      createNode('trigger', 'TRIGGER', triggerConfig, 'Button Click'),
      createNode('intro', 'SEND_TEXT', { message: data.introMessage || 'Hi! Let me help you book an appointment.' }, 'Intro'),
      createNode('schedule', 'START_SCHEDULING', {
        introMessage: `Okay, let's schedule your ${data.serviceName || 'appointment'}.`,
        consultationType: data.consultationType || 'Consultation',
      }, 'Schedule'),
    ];
    return { nodes, edges: [createEdge('e1', 'trigger', 'intro'), createEdge('e2', 'intro', 'schedule')] };
  }

  // inbound_keyword path — use typed trigger node
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER_INBOUND_KEYWORD', {
      keywords: data.triggerKeywords?.filter(Boolean) ?? ['book', 'appointment'],
    }, 'Keyword: Book'),
    createNode('intro', 'SEND_TEXT', { message: data.introMessage || 'Hi! Let me help you book an appointment.' }, 'Intro'),
    createNode('schedule', 'START_SCHEDULING', {
      introMessage: `Okay, let's schedule your ${data.serviceName || 'appointment'}.`,
      consultationType: data.consultationType || 'Consultation',
    }, 'Schedule'),
  ];

  return {
    nodes,
    edges: [
      createEdge('e1', 'trigger', 'intro'),
      createEdge('e2', 'intro', 'schedule'),
    ],
  };
}

// ── S2: Answer Product Questions ────────────────────────────────────────────────

export interface S2FormData {
  triggerKeywords?: string[];
  questionPrompt?: string;
  answerTemplate?: string;
}

export function buildS2Flow(data: S2FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER_INBOUND_KEYWORD', {
      keywords: data.triggerKeywords?.filter(Boolean) ?? ['info', 'product', 'price'],
    }, 'Keyword: Info'),
    createNode('ask', 'SEND_TEXT', {
      message: data.questionPrompt || 'What product are you interested in?',
    }, 'Ask Question'),
    createNode('answer', 'SEND_TEXT', {
      message: data.answerTemplate || "Here's the information you need.",
    }, 'Send Answer'),
    createNode('end', 'END_FLOW', { reason: 'Question answered' }, 'End'),
  ];

  return {
    nodes,
    edges: [
      createEdge('e1', 'trigger', 'ask'),
      createEdge('e2', 'ask', 'answer'),
      createEdge('e3', 'answer', 'end'),
    ],
  };
}

// ── S3: Collect a Lead — upgraded to use COLLECT_INFO ───────────────────────────

export interface S3FormData {
  triggerKeywords?: string[];
  /** Array of question prompt strings — migrated to COLLECT_INFO questions */
  qualifyingQuestions?: string[];
  followUpMessage?: string;
}

export function buildS3Flow(data: S3FormData): FlowDefinition {
  const rawQuestions = (data.qualifyingQuestions ?? []).filter(Boolean);
  if (rawQuestions.length === 0) rawQuestions.push("What's your name?", "What are you looking for?");

  // Build CollectInfoQuestion objects from plain-text prompts
  const collectInfoQuestions = rawQuestions.map((q, i) => ({
    id: `q${i + 1}`,
    promptText: q,
    variableName: `answer_${i + 1}`,
    type: 'text' as const,
    required: true,
  }));

  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER_INBOUND_KEYWORD', {
      keywords: data.triggerKeywords?.filter(Boolean) ?? ['lead', 'interested', 'info'],
    }, 'Keyword: Lead'),
    createNode('collect', 'COLLECT_INFO', {
      questions: collectInfoQuestions,
      onComplete: 'continue',
    }, 'Collect Info'),
    createNode('tagLead', 'TAG_BUYER', { action: 'add', tag: 'lead' }, 'Tag Lead'),
    createNode('followUp', 'SEND_TEXT', {
      message: data.followUpMessage || "Thanks! We'll be in touch soon. 😊",
    }, 'Follow Up'),
    createNode('end', 'END_FLOW', { reason: 'Lead captured' }, 'End'),
  ];

  return {
    nodes,
    edges: [
      createEdge('e1', 'trigger', 'collect'),
      createEdge('e2', 'collect', 'tagLead'),
      createEdge('e3', 'tagLead', 'followUp'),
      createEdge('e4', 'followUp', 'end'),
    ],
  };
}

// ── S4: Broadcast Announcement ──────────────────────────────────────────────────
// Keeps TRIGGER (broadcast type) — this is driven by broadcastToSegment, not keyword.

export interface S4FormData {
  broadcastMessage?: string;
  followUpMessage?: string;
}

export function buildS4Flow(data: S4FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER', { triggerType: 'broadcast' }, 'Start'),
    createNode('gate', 'SEGMENT_QUALITY_GATE', { requireOrders: false }, 'Quality Check'),
    createNode('send', 'SEND_TEXT', { message: data.broadcastMessage || 'Your announcement here.' }, 'Send Broadcast'),
    createNode('followUp', 'SEND_TEXT', {
      message: data.followUpMessage || 'Feel free to reach out if you have questions!',
    }, 'Follow Up'),
    createNode('end', 'END_FLOW', { reason: 'Broadcast sent' }, 'End'),
  ];

  return {
    nodes,
    edges: [
      createEdge('e1', 'trigger', 'gate'),
      createEdge('e2', 'gate', 'send'),
      createEdge('e3', 'send', 'followUp'),
      createEdge('e4', 'followUp', 'end'),
    ],
  };
}

// ── S5: Human Handoff ───────────────────────────────────────────────────────────

export interface S5FormData {
  triggerKeywords?: string[];
  handoffMessage?: string;
  consultationType?: string;
}

export function buildS5Flow(data: S5FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER_INBOUND_KEYWORD', {
      keywords: data.triggerKeywords?.filter(Boolean) ?? ['help', 'support', 'agent'],
    }, 'Keyword: Help'),
    createNode('notify', 'SEND_TEXT', {
      message: data.handoffMessage || 'Connecting you to our team...',
    }, 'Notify Buyer'),
    createNode('handoff', 'START_SCHEDULING', {
      introMessage: 'A team member will be with you shortly.',
      consultationType: data.consultationType || 'Support',
    }, 'Handoff to Staff'),
  ];

  return {
    nodes,
    edges: [
      createEdge('e1', 'trigger', 'notify'),
      createEdge('e2', 'notify', 'handoff'),
    ],
  };
}

// ── S6: Order Follow-Up — new in v3 Phase 4 ────────────────────────────────────

export type OrderFollowUpEvent = 'payment_confirmed' | 'shipped' | 'delivered' | 'payment_failed';

export interface S6FormData {
  /** Order lifecycle event that fires this flow */
  orderEvent?: OrderFollowUpEvent;
  /** Message to send when the event fires */
  followUpMessage?: string;
}

export function buildS6Flow(data: S6FormData): FlowDefinition {
  const event = data.orderEvent ?? 'payment_confirmed';

  const DEFAULT_MESSAGES: Record<OrderFollowUpEvent, string> = {
    payment_confirmed: '✅ Pembayaran kamu sudah kami terima! Pesanan akan segera diproses 🎉',
    shipped: '📦 Paket kamu sudah dalam perjalanan! Cek statusnya melalui link pelacakan yang kami kirimkan.',
    delivered: '🎉 Paket kamu sudah sampai! Terima kasih telah berbelanja. Ada yang bisa kami bantu?',
    payment_failed: '⚠️ Pembayaran belum kami terima. Silakan selesaikan pembayaran agar pesananmu bisa diproses ya, Kak 🙏',
  };

  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER_ORDER_EVENT', {
      orderEvent: event,
    }, `Order: ${event}`),
    createNode('message', 'SEND_TEXT', {
      message: data.followUpMessage || DEFAULT_MESSAGES[event],
    }, 'Follow-Up Message'),
    createNode('end', 'END_FLOW', { reason: 'Order follow-up sent' }, 'End'),
  ];

  return {
    nodes,
    edges: [
      createEdge('e1', 'trigger', 'message'),
      createEdge('e2', 'message', 'end'),
    ],
  };
}

// ── Builder Dispatcher ──────────────────────────────────────────────────────────

export type ScenarioFormData = S1FormData | S2FormData | S3FormData | S4FormData | S5FormData | S6FormData;

export function buildScenarioFlow(
  templateId: string,
  formData: Record<string, unknown>,
): FlowDefinition {
  switch (templateId) {
    case 'S1':
      return buildS1Flow(formData as S1FormData);
    case 'S2':
      return buildS2Flow(formData as S2FormData);
    case 'S3':
      return buildS3Flow(formData as S3FormData);
    case 'S4':
      return buildS4Flow(formData as S4FormData);
    case 'S5':
      return buildS5Flow(formData as S5FormData);
    case 'S6':
      return buildS6Flow(formData as S6FormData);
    default:
      throw new Error(`Unknown template: ${templateId}`);
  }
}
