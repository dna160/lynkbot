/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/messages.ts
 * Role    : Drizzle ORM schema for messages table and messageDirection enum
 * Imports : drizzle-orm/pg-core, ./conversations, ./tenants
 * Exports : messages, messageDirectionEnum
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations';
import { tenants } from './tenants';

export const messageDirectionEnum = pgEnum('message_direction', [
  'inbound',
  'outbound',
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  watiMessageId: varchar('wati_message_id', { length: 255 }),
  direction: messageDirectionEnum('direction').notNull(),
  messageType: varchar('message_type', { length: 50 }).notNull().default('text'),
  textContent: text('text_content'),
  mediaUrl: text('media_url'),
  locationLat: varchar('location_lat', { length: 20 }),
  locationLng: varchar('location_lng', { length: 20 }),
  rawPayload: jsonb('raw_payload'),
  tokensUsed: integer('tokens_used'),
  modelId: varchar('model_id', { length: 100 }),
  latencyMs: integer('latency_ms'),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
