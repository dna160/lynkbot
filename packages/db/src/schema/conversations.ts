/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/conversations.ts
 * Role    : Drizzle ORM schema for conversations table and conversationState enum
 * Imports : drizzle-orm/pg-core, ./tenants, ./buyers, ./products
 * Exports : conversations, conversationStateEnum, PlaybookOverrideData
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  jsonb,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { buyers } from './buyers';
import { products } from './products';

/**
 * Typed shape for conversations.playbook_override (JSONB).
 *
 * Two variants:
 *   - 'staff'    — set by START_SCHEDULING. Carries the staff UUID to notify for
 *                  appointment confirmations, and the confirmation model chosen in
 *                  the wizard. Read by scheduling handlers in api and worker.
 *   - 'playbook' — set by ACTIVATE_PLAYBOOK. Carries the intentKey used for AI
 *                  prompt lookup until the conversation state is transitioned.
 *                  Read by sendAiResponse in api and worker.
 *
 * Migration 0030 converts all existing varchar rows to this shape.
 */
export type PlaybookOverrideData =
  | { type: 'staff'; staffId?: string; confirmationModel?: 'instant' | 'staff_confirm'; serviceId?: string }
  | { type: 'playbook'; intentKey: string };

export const conversationStateEnum = pgEnum('conversation_state', [
  'INIT',
  'GREETING',
  'BROWSING',
  'PRODUCT_INQUIRY',
  'OBJECTION_HANDLING',
  'CHECKOUT_INTENT',
  'STOCK_CHECK',
  'OUT_OF_STOCK',
  'ADDRESS_COLLECTION',
  'LOCATION_RECEIVED',
  'SHIPPING_CALC',
  'PAYMENT_METHOD_SELECT',
  'INVOICE_GENERATION',
  'AWAITING_PAYMENT',
  'PAYMENT_EXPIRED',
  'PAYMENT_CONFIRMED',
  'ORDER_PROCESSING',
  'SHIPPED',
  'TRACKING',
  'DELIVERED',
  'COMPLETED',
  'ESCALATED',
  'CLOSED_LOST',
  // Scheduling module (migration 0012)
  'SCHEDULING',
  'SCHEDULING_CONFIRMED',
  'SCHEDULING_CANCELLED',
  // Rescheduling (migration 0015)
  'SCHEDULING_RESCHEDULING_PENDING',
]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  buyerId: uuid('buyer_id')
    .references(() => buyers.id, { onDelete: 'set null' }),
  productId: uuid('product_id')
    .references(() => products.id, { onDelete: 'set null' }),
  state: conversationStateEnum('state').notNull().default('INIT'),
  language: varchar('language', { length: 10 }).notNull().default('id'),
  addressDraft: jsonb('address_draft').$type<{
    streetAddress?: string;
    kelurahan?: string;
    kecamatan?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    rajaongkirCityId?: string;
    source?: 'location_share' | 'text_input';
    step?: number;
  }>(),
  selectedCourier: jsonb('selected_courier').$type<{
    code: string;
    service: string;
    cost: number;
    etaDays: number;
    name: string;
  }>(),
  pendingOrderId: uuid('pending_order_id'),
  /**
   * Set by START_SCHEDULING or ACTIVATE_PLAYBOOK flow nodes.
   * Migration 0030 converted this from VARCHAR(50) to JSONB.
   * Use the PlaybookOverrideData type to read/write this field.
   */
  playbookOverride: jsonb('playbook_override').$type<PlaybookOverrideData>(),
  messageCount: integer('message_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});
