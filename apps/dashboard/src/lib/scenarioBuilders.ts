/**
 * @CLAUDE_CONTEXT
 * File    : src/lib/scenarioBuilders.ts
 * Role    : Deterministic flow builders for S1-S5 scenarios (Phase 3)
 *           Pure functions: (form data) → FlowDefinition
 *           NO LLM, NO external I/O
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
  serviceName?: string;
  introMessage?: string;
  consultationType?: string;
}

export function buildS1Flow(data: S1FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER', { triggerType: 'button_click' }, 'Start'),
    createNode('intro', 'SEND_TEXT', { message: data.introMessage || 'Hi! Let me help you book an appointment.' }, 'Intro'),
    createNode('schedule', 'START_SCHEDULING', {
      introMessage: `Okay, let's schedule your ${data.serviceName || 'appointment'}.`,
      consultationType: data.consultationType || 'Consultation',
    }, 'Schedule'),
    createNode('end', 'END_FLOW', { reason: 'Appointment booked' }, 'End'),
  ];

  const edges: FlowEdge[] = [
    createEdge('e1', 'trigger', 'intro'),
    createEdge('e2', 'intro', 'schedule'),
    createEdge('e3', 'schedule', 'end'),
  ];

  return { nodes, edges };
}

// ── S2: Answer Product Questions ────────────────────────────────────────────────

export interface S2FormData {
  questionPrompt?: string;
  answerTemplate?: string;
}

export function buildS2Flow(data: S2FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER', { triggerType: 'inbound_keyword' }, 'Start'),
    createNode('ask', 'SEND_TEXT', {
      message: data.questionPrompt || 'What product are you interested in?',
    }, 'Ask Question'),
    createNode('answer', 'SEND_TEXT', {
      message: data.answerTemplate || "Here's the information you need.",
    }, 'Send Answer'),
    createNode('end', 'END_FLOW', { reason: 'Question answered' }, 'End'),
  ];

  const edges: FlowEdge[] = [
    createEdge('e1', 'trigger', 'ask'),
    createEdge('e2', 'ask', 'answer'),
    createEdge('e3', 'answer', 'end'),
  ];

  return { nodes, edges };
}

// ── S3: Collect a Lead ──────────────────────────────────────────────────────────

export interface S3FormData {
  leadQuestion?: string;
  followUpMessage?: string;
}

export function buildS3Flow(data: S3FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER', { triggerType: 'inbound_keyword' }, 'Start'),
    createNode('ask', 'SEND_TEXT', {
      message: data.leadQuestion || "What's your name?",
    }, 'Collect Name'),
    createNode('capture', 'WAIT_FOR_REPLY', {}, 'Capture Reply'),
    createNode('tagLead', 'TAG_BUYER', { action: 'add', tag: 'lead' }, 'Tag Lead'),
    createNode('followUp', 'SEND_TEXT', {
      message: data.followUpMessage || "Thanks! We'll be in touch soon.",
    }, 'Follow Up'),
    createNode('end', 'END_FLOW', { reason: 'Lead captured' }, 'End'),
  ];

  const edges: FlowEdge[] = [
    createEdge('e1', 'trigger', 'ask'),
    createEdge('e2', 'ask', 'capture'),
    createEdge('e3', 'capture', 'tagLead'),
    createEdge('e4', 'tagLead', 'followUp'),
    createEdge('e5', 'followUp', 'end'),
  ];

  return { nodes, edges };
}

// ── S4: Broadcast Announcement ──────────────────────────────────────────────────

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

  const edges: FlowEdge[] = [
    createEdge('e1', 'trigger', 'gate'),
    createEdge('e2', 'gate', 'send', 'default'),
    createEdge('e3', 'send', 'followUp'),
    createEdge('e4', 'followUp', 'end'),
  ];

  return { nodes, edges };
}

// ── S5: Human Handoff ───────────────────────────────────────────────────────────

export interface S5FormData {
  handoffMessage?: string;
  consultationType?: string;
}

export function buildS5Flow(data: S5FormData): FlowDefinition {
  const nodes: FlowNode[] = [
    createNode('trigger', 'TRIGGER', { triggerType: 'inbound_keyword' }, 'Start'),
    createNode('notify', 'SEND_TEXT', {
      message: data.handoffMessage || 'Connecting you to our team...',
    }, 'Notify Buyer'),
    createNode('handoff', 'START_SCHEDULING', {
      introMessage: 'A team member will be with you shortly.',
      consultationType: data.consultationType || 'Support',
    }, 'Handoff to Staff'),
    createNode('end', 'END_FLOW', { reason: 'Handed off to staff' }, 'End'),
  ];

  const edges: FlowEdge[] = [
    createEdge('e1', 'trigger', 'notify'),
    createEdge('e2', 'notify', 'handoff'),
    createEdge('e3', 'handoff', 'end'),
  ];

  return { nodes, edges };
}

// ── Builder Dispatcher ──────────────────────────────────────────────────────────

export type ScenarioFormData = S1FormData | S2FormData | S3FormData | S4FormData | S5FormData;

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
    default:
      throw new Error(`Unknown template: ${templateId}`);
  }
}
