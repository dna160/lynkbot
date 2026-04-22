/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/constants/states.ts
 * Role    : ConversationState string values as constants (complements the enum)
 * Imports : nothing (zero deps)
 * Exports : CONVERSATION_STATES array, ConversationStateValue type
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
export const CONVERSATION_STATES = [
  'INIT', 'GREETING', 'BROWSING', 'PRODUCT_INQUIRY', 'OBJECTION_HANDLING',
  'CHECKOUT_INTENT', 'STOCK_CHECK', 'OUT_OF_STOCK', 'ADDRESS_COLLECTION',
  'LOCATION_RECEIVED', 'SHIPPING_CALC', 'PAYMENT_METHOD_SELECT',
  'INVOICE_GENERATION', 'AWAITING_PAYMENT', 'PAYMENT_EXPIRED',
  'PAYMENT_CONFIRMED', 'ORDER_PROCESSING', 'SHIPPED', 'TRACKING',
  'DELIVERED', 'COMPLETED', 'ESCALATED', 'CLOSED_LOST',
] as const;

export type ConversationStateValue = typeof CONVERSATION_STATES[number];

export const TERMINAL_STATES: ConversationStateValue[] = ['COMPLETED', 'CLOSED_LOST'];
export const ACTIVE_STATES: ConversationStateValue[] = CONVERSATION_STATES.filter(
  s => !TERMINAL_STATES.includes(s as ConversationStateValue)
) as ConversationStateValue[];

export const ESCALATABLE_STATES: ConversationStateValue[] = [
  'BROWSING', 'PRODUCT_INQUIRY', 'OBJECTION_HANDLING', 'CHECKOUT_INTENT',
  'ADDRESS_COLLECTION', 'SHIPPING_CALC', 'PAYMENT_METHOD_SELECT',
  'AWAITING_PAYMENT', 'ORDER_PROCESSING',
];
