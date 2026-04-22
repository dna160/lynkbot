/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/orders.ts
 * Role    : Drizzle ORM schema for orders table and orderStatus enum
 * Imports : drizzle-orm/pg-core, ./tenants, ./buyers, ./products, ./conversations
 * Exports : orders, orderStatusEnum
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
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { buyers } from './buyers';
import { products } from './products';
import { conversations } from './conversations';

export const orderStatusEnum = pgEnum('order_status', [
  'pending_payment',
  'payment_confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderCode: varchar('order_code', { length: 50 }).notNull().unique(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  buyerId: uuid('buyer_id')
    .notNull()
    .references(() => buyers.id, { onDelete: 'restrict' }),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'set null' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(1),
  unitPriceIdr: integer('unit_price_idr').notNull(),
  shippingCostIdr: integer('shipping_cost_idr').notNull().default(0),
  totalAmountIdr: integer('total_amount_idr').notNull(),
  status: orderStatusEnum('status').notNull().default('pending_payment'),
  shippingAddress: jsonb('shipping_address').notNull().$type<{
    streetAddress: string;
    kelurahan: string;
    kecamatan: string;
    city: string;
    province: string;
    postalCode: string;
    rajaongkirCityId: string;
    source: 'location_share' | 'text_input';
  }>(),
  courierCode: varchar('courier_code', { length: 50 }),
  courierService: varchar('courier_service', { length: 100 }),
  paymentId: varchar('payment_id', { length: 255 }),
  paymentMethod: varchar('payment_method', { length: 50 }),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
