/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/broadcasts.ts
 * Role    : Drizzle ORM schema for broadcasts table
 * Exports : broadcasts
 */
import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  templateName: varchar('template_name', { length: 255 }).notNull(),
  templateParams: jsonb('template_params').notNull().default([]),
  audienceFilter: jsonb('audience_filter'),
  recipientCount: integer('recipient_count').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  errorLog: jsonb('error_log'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});
