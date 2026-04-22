/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/auditLogs.ts
 * Role    : Drizzle ORM schema for audit_logs table (immutable event log)
 * Imports : drizzle-orm/pg-core, ./tenants
 * Exports : auditLogs
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'set null' }),
  actorId: varchar('actor_id', { length: 255 }),
  actorType: varchar('actor_type', { length: 50 }).notNull().default('system'),
  action: varchar('action', { length: 255 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: varchar('resource_id', { length: 255 }),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
