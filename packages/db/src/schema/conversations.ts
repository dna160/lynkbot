/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/conversations.ts
 * Role    : Drizzle ORM schema for conversations table and conversationState enum
 * Imports : drizzle-orm/pg-core, ./tenants, ./buyers, ./products
 * Exports : conversations, conversationStateEnum
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
]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  buyerId: uuid('buyer_id')
    .notNull()
    .references(() => buyers.id, { onDelete: 'cascade' }),
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
  messageCount: integer('message_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});
