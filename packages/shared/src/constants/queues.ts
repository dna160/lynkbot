/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/constants/queues.ts
 * Role    : BullMQ queue name constants — single source of truth
 * Imports : nothing (zero deps)
 * Exports : QUEUES constant object and QueueName type
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
export const QUEUES = {
  INGEST: 'lynkbot-ingest',
  TRACKING: 'lynkbot-tracking',
  PAYMENT_EXPIRY: 'lynkbot-payment-expiry',
  STOCK_RELEASE: 'lynkbot-stock-release',
  RESTOCK_NOTIFY: 'lynkbot-restock-notify',
  SEND_TEMPLATE: 'lynkbot-send-template',
  // Flow Engine v2.1
  FLOW_EXECUTION: 'lynkbot-flow-execution',
  TEMPLATE_SYNC: 'lynkbot-template-sync',
  RISK_SCORE: 'lynkbot-risk-score',
  // Scheduling module
  REMINDERS: 'lynkbot-reminders',
  // Webhook durability
  WEBHOOK_PROCESS: 'lynkbot-webhook-process',
  // Broadcast batching
  BROADCAST_BATCH: 'lynkbot-broadcast-batch',
} as const;

export type QueueName = typeof QUEUES[keyof typeof QUEUES];
