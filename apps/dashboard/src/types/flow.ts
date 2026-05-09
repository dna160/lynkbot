/**
 * @CLAUDE_CONTEXT
 * File    : src/types/flow.ts
 * Role    : Local copy of FlowDefinition types for dashboard (Phase 3 Scenario Builder)
 * Source  : packages/flow-engine/src/types.ts (copied for dashboard independence)
 * Why     : Dashboard has no workspace dep on flow-engine; types copied locally
 */

// ── Node Types ────────────────────────────────────────────────────────────────

export type NodeType =
  | 'TRIGGER'
  | 'SEND_TEMPLATE'
  | 'SEND_TEXT'
  | 'SEND_INTERACTIVE'
  | 'SEND_MEDIA'
  | 'DELAY'
  | 'WAIT_FOR_REPLY'
  | 'IF_CONDITION'
  | 'KEYWORD_ROUTER'
  | 'TAG_BUYER'
  | 'UPDATE_BUYER'
  | 'SEND_WINDOW'
  | 'RATE_LIMIT'
  | 'SEGMENT_QUALITY_GATE'
  | 'END_FLOW'
  | 'START_SCHEDULING'
  | 'ACTIVATE_PLAYBOOK'
  | 'AGENT';

// ── Trigger Types ─────────────────────────────────────────────────────────────

export type TriggerType = 'button_click' | 'broadcast' | 'time_based' | 'inbound_keyword';

export interface TriggerConfig {
  triggerType: TriggerType;
  buttonPayloadPrefix?: string;
  cronExpression?: string;
  keywords?: string[];
  segmentFilter?: SegmentFilter;
}

export interface SegmentFilter {
  tags?: string[];
  minTotalOrders?: number;
  maxTotalOrders?: number;
  lastOrderWithinDays?: number;
  preferredLanguage?: string;
}

// ── Node Config Types ──────────────────────────────────────────────────────────

export interface SendTemplateConfig {
  templateName: string;
  languageCode?: string;
  components?: Array<{ type: string; parameters?: Array<{ type: string; text?: string }> }>;
}

export interface SendTextConfig {
  message: string;
}

export interface SendInteractiveConfig {
  type: 'button' | 'list';
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: Array<{ id: string; title: string }>;
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
}

export interface SendMediaConfig {
  mediaType: 'image' | 'video' | 'document' | 'audio';
  mediaUrl: string;
  caption?: string;
}

export interface DelayConfig {
  delayMs: number;
}

export interface WaitForReplyConfig {
  timeoutMs?: number;
}

export interface IfConditionConfig {
  conditions: ConditionGroup;
}

export interface KeywordRouterConfig {
  keywords: string[];
  defaultAction?: string;
}

export interface TagBuyerConfig {
  action: 'add' | 'remove';
  tag: string;
}

export interface UpdateBuyerConfig {
  field: 'displayName' | 'notes' | 'preferredLanguage';
  value: string;
}

export interface SendWindowConfig {
  startHour: number;
  endHour: number;
}

export interface RateLimitConfig {
  maxPerHour?: number;
}

export interface SegmentQualityGateConfig {
  requireOrders?: boolean;
  requireInboundHistory?: boolean;
}

export interface EndFlowConfig {
  reason?: string;
}

export interface StartSchedulingConfig {
  introMessage?: string;
  consultationType?: string;
  assignedStaffId?: string;
}

export interface ActivatePlaybookConfig {
  intentKey: string;
}

export interface AgentStaffNotification {
  staffId: string;
  message: string;
}

export interface AgentConfig {
  instructions: string;
  memoryEnabled: boolean;
  introMessage?: string;
  consultationType?: string;
  assignedStaffId?: string;
  staffMessage?: string;
  additionalStaffNotifications?: AgentStaffNotification[];
}

export type NodeConfig =
  | SendTemplateConfig
  | SendTextConfig
  | SendInteractiveConfig
  | SendMediaConfig
  | DelayConfig
  | WaitForReplyConfig
  | IfConditionConfig
  | KeywordRouterConfig
  | TagBuyerConfig
  | UpdateBuyerConfig
  | SendWindowConfig
  | RateLimitConfig
  | SegmentQualityGateConfig
  | EndFlowConfig
  | StartSchedulingConfig
  | ActivatePlaybookConfig
  | AgentConfig
  | Record<string, unknown>;

// ── Graph Structures ───────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: NodeType;
  label?: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
  validationErrors?: string[];
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ── Condition Types ────────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'is_set'
  | 'is_not_set'
  | 'days_since'
  | 'includes_tag'
  | 'not_includes_tag';

export type ConditionField =
  | 'buyer.name'
  | 'buyer.phone'
  | 'buyer.totalOrders'
  | 'buyer.tags'
  | 'buyer.lastOrderAt'
  | 'trigger.type'
  | 'trigger.buttonPayload'
  | `flow.variable.${string}`;

export interface Condition {
  field: ConditionField | string;
  operator: ConditionOperator;
  value?: string | number | boolean;
}

export interface ConditionGroup {
  logic: 'AND' | 'OR';
  conditions: Condition[];
}
