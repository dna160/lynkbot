/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/shipments.ts
 * Role    : Drizzle ORM schema for shipments table and shipmentStatus enum
 * Imports : drizzle-orm/pg-core, ./orders, ./tenants
 * Exports : shipments, shipmentStatusEnum
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { tenants } from './tenants';

export const shipmentStatusEnum = pgEnum('shipment_status', [
  'pending',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
  'returned',
]);

export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  resiNumber: varchar('resi_number', { length: 100 }).notNull(),
  courierCode: varchar('courier_code', { length: 50 }).notNull(),
  courierName: varchar('courier_name', { length: 100 }),
  currentStatus: shipmentStatusEnum('current_status').notNull().default('pending'),
  estimatedDelivery: timestamp('estimated_delivery'),
  deliveredAt: timestamp('delivered_at'),
  lastPolledAt: timestamp('last_polled_at'),
  trackingHistory: jsonb('tracking_history')
    .notNull()
    .$type<Array<{ status: string; description: string; timestamp: string }>>()
    .default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
