/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/opsTickets.ts
 * Role    : Drizzle ORM schema for ops_tickets table
 * Imports : drizzle-orm/pg-core only
 * Exports : opsTickets
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

export const opsTickets = pgTable('ops_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 100 }).notNull(),
  tenantId: uuid('tenant_id').notNull(),
  payload: jsonb('payload'),
  status: varchar('status', { length: 50 }).default('open'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
