/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/consentAudit.ts
 * Role    : PDP Law compliance audit trail for buyer consent
 * Imports : drizzle-orm/pg-core only
 * Exports : consentAudit, consentActionEnum
 */
import { pgTable, pgEnum, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { buyers } from './buyers';

export const consentActionEnum = pgEnum('consent_action', [
  'opt_in',
  'opt_out',
  'template_sent',
  'broadcast_sent',
]);

export const consentAudit = pgTable('consent_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  buyerId: uuid('buyer_id').references(() => buyers.id, { onDelete: 'set null' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  action: consentActionEnum('action').notNull(),
  channel: text('channel').notNull().default('whatsapp'),
  templateName: text('template_name'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
