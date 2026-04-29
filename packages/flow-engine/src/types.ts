/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/types.ts
 * Role    : Core type definitions for the Flow Engine v2.1.
 *           All interfaces and the NodeType union must match exactly — Phase 5
 *           dashboard and Phase 4 risk scoring depend on these types.
 * Exports : NodeType, FlowNode, FlowEdge, FlowDefinition, TriggerConfig,
 *           ExecutionContext, Condition, ConditionGroup, RiskBreakdown
 * DO NOT  : Import from @lynkbot/db or apps/*
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
  | 'END_FLOW';

// ── Trigger Types ─────────────────────────────────────────────────────────────

export type TriggerType =
  | 'button_click'
  | 'broadcast'
  | 'time_based'
  | 'inbound_keyword';

export interface TriggerConfig {
  triggerType: TriggerType;
  /** For button_click: the expected button payload prefix (e.g. 'flow:') */
  buttonPayloadPrefix?: string;
  /** For time_based: cron expression (Phase 4) */
  cronExpression?: string;
  /** For inbound_keyword: keywords to match */
  keywords?: string[];
  /** For broadcast: segment filter (Phase 4) */
  segmentFilter?: SegmentFilter;
}

export interface SegmentFilter {
  tags?: string[];
  minTotalOrders?: number;
  maxTotalOrders?: number;
  lastOrderWithinDays?: number;
  preferredLanguage?: string;
}

// ── Node Config Types (per node type) ────────────────────────────────────────

export interface SendTemplateConfig {
  templateName: string;
  languageCode?: string;
  /** Components with variable templates e.g. {{buyer.name}} */
  components?: Array<{
    type: string;
    parameters?: Array<{
      type: string;
      text?: string;
    }>;
  }>;
}

export interface SendTextConfig {
  /** Message body, may contain {{buyer.name}} etc. */
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
  /** Optional timeout in ms after which flow continues (0 = infinite) */
  timeoutMs?: number;
}

export interface IfConditionConfig {
  conditions: ConditionGroup;
}

export interface KeywordRouterConfig {
  /** Each keyword maps to an output port by its array index */
  keywords: string[];
  /** Default port when no keyword matches */
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
  /** Start hour (0-23) in Jakarta time UTC+7 */
  startHour: number;
  /** End hour (0-23) in Jakarta time UTC+7 */
  endHour: number;
}

export interface RateLimitConfig {
  /** Max sends per hour (default 1000) */
  maxPerHour?: number;
}

export interface SegmentQualityGateConfig {
  /** Require at least 1 order */
  requireOrders?: boolean;
  /** Require inbound message history */
  requireInboundHistory?: boolean;
}

export interface EndFlowConfig {
  reason?: string;
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
  | Record<string, unknown>;

// ── Graph Structures ──────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: NodeType;
  label?: string;
  config: NodeConfig;
  /** Visual position (used by Phase 5 Drawflow canvas) */
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  /** Source node id */
  source: string;
  /** Target node id */
  target: string;
  /**
   * Output port from source node:
   * - 'default' — normal/fallthrough
   * - 'true' / 'false' — from IF_CONDITION
   * - 'outside' — from SEND_WINDOW (outside time window)
   * - 'excluded' — from SEGMENT_QUALITY_GATE
   * - string index — from KEYWORD_ROUTER ('0', '1', etc.)
   */
  sourcePort?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ── Condition Types ───────────────────────────────────────────────────────────

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
  /** Value to compare against (not needed for is_set/is_not_set) */
  value?: string | number | boolean;
}

export interface ConditionGroup {
  logic: 'AND' | 'OR';
  conditions: Condition[];
}

// ── Execution Context ─────────────────────────────────────────────────────────

export interface BuyerContext {
  id: string;
  waPhone: string;
  name: string;
  totalOrders: number;
  tags: string[];
  lastOrderAt?: Date | null;
  doNotContact: boolean;
  preferredLanguage: string;
  notes?: string | null;
  displayName?: string | null;
  activeFlowCount: number;
}

export interface TriggerContext {
  type: TriggerType;
  buttonPayload?: string;
  messageText?: string;
  conversationId?: string;
}

export interface ExecutionContext {
  executionId: string;
  flowId: string;
  tenantId: string;
  buyerId: string;
  buyer: BuyerContext;
  trigger: TriggerContext;
  /** Flow-scoped runtime variables (SET_VARIABLE node, not yet in v2.1) */
  variables: Record<string, unknown>;
  /** Execution log entries (appended by engine) */
  executionLog: ExecutionLogEntry[];
  /** WABA id for rate limiting */
  wabaId?: string;
}

export interface ExecutionLogEntry {
  nodeId: string;
  nodeType: NodeType;
  timestamp: string;
  status: 'ok' | 'skipped' | 'error' | 'waiting';
  skipReason?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

// ── Risk Score ────────────────────────────────────────────────────────────────

export interface RiskBreakdown {
  broadcastFrequencyScore: number;
  templateQualityScore: number;
  blockProxyScore: number;
  optInConfidenceScore: number;
  sendSpeedScore: number;
  total: number;
}
