/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/waitlist.ts
 * Role    : Drizzle ORM schema for waitlist table (out-of-stock notification queue)
 * Imports : drizzle-orm/pg-core, ./products, ./tenants, ./buyers
 * Exports : waitlist
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import { products } from './products';
import { tenants } from './tenants';
import { buyers } from './buyers';

export const waitlist = pgTable('waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  buyerId: uuid('buyer_id')
    .references(() => buyers.id, { onDelete: 'set null' }),
  waPhone: varchar('wa_phone', { length: 20 }).notNull(),
  buyerName: varchar('buyer_name', { length: 255 }),
  quantityRequested: integer('quantity_requested').notNull().default(1),
  notifiedAt: timestamp('notified_at'),
  isNotified: boolean('is_notified').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
