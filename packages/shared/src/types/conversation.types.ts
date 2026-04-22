/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/types/conversation.types.ts
 * Role    : All conversation-related TypeScript types and enums
 * Imports : nothing (zero deps)
 * Exports : ConversationState, Conversation, ShippingAddress, etc.
 * DO NOT  : Import from @lynkbot/* or apps/*
 */

export enum ConversationState {
  INIT = 'INIT',
  GREETING = 'GREETING',
  BROWSING = 'BROWSING',
  PRODUCT_INQUIRY = 'PRODUCT_INQUIRY',
  OBJECTION_HANDLING = 'OBJECTION_HANDLING',
  CHECKOUT_INTENT = 'CHECKOUT_INTENT',
  STOCK_CHECK = 'STOCK_CHECK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  ADDRESS_COLLECTION = 'ADDRESS_COLLECTION',
  LOCATION_RECEIVED = 'LOCATION_RECEIVED',
  SHIPPING_CALC = 'SHIPPING_CALC',
  PAYMENT_METHOD_SELECT = 'PAYMENT_METHOD_SELECT',
  INVOICE_GENERATION = 'INVOICE_GENERATION',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PAYMENT_EXPIRED = 'PAYMENT_EXPIRED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  ORDER_PROCESSING = 'ORDER_PROCESSING',
  SHIPPED = 'SHIPPED',
  TRACKING = 'TRACKING',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  ESCALATED = 'ESCALATED',
  CLOSED_LOST = 'CLOSED_LOST',
}

export interface Conversation {
  id: string;
  tenantId: string;
  buyerId: string;
  productId: string | null;
  state: ConversationState;
  language: 'id' | 'en';
  addressDraft: AddressDraft | null;
  selectedCourier: SelectedCourier | null;
  pendingOrderId: string | null;
  messageCount: number;
  isActive: boolean;
  startedAt: Date;
  lastMessageAt: Date;
  resolvedAt: Date | null;
}

export interface AddressDraft {
  streetAddress?: string;
  kelurahan?: string;
  kecamatan?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  rajaongkirCityId?: string;
  source?: 'location_share' | 'text_input';
  step?: number;
}

export interface SelectedCourier {
  code: string;
  service: string;
  cost: number;
  etaDays: number;
  name: string;
}

export interface WaLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}
