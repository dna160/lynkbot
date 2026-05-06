/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/webhookIngestLog.ts
 * Role    : Durability log for Meta webhook ingestion — idempotency + replay
 * Imports : drizzle-orm/pg-core only
 * Exports : webhookIngestLog, webhookIngestStatusEnum
 */
import { pgTable, pgEnum, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const webhookIngestStatusEnum = pgEnum('webhook_ingest_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const webhookIngestLog = pgTable('webhook_ingest_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  metaMessageId: text('meta_message_id').notNull().unique(),
  phoneNumberId: text('phone_number_id').notNull(),
  payload: jsonb('payload').notNull(),
  status: webhookIngestStatusEnum('status').notNull().default('pending'),
  processedAt: timestamp('processed_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
