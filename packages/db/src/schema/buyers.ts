/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/buyers.ts
 * Role    : Drizzle ORM schema for buyers table
 * Imports : drizzle-orm/pg-core, ./tenants
 * Exports : buyers
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const buyers = pgTable('buyers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  waPhone: varchar('wa_phone', { length: 20 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  preferredLanguage: varchar('preferred_language', { length: 10 }).default('id'),
  totalOrders: integer('total_orders').notNull().default(0),
  totalSpendIdr: integer('total_spend_idr').notNull().default(0),
  lastOrderAt: timestamp('last_order_at'),
  tags: jsonb('tags').$type<string[]>(),
  notes: text('notes'),
  doNotContact: boolean('do_not_contact').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniquePhoneTenant: unique().on(t.waPhone, t.tenantId),
}));
