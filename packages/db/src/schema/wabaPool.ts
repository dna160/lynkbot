/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/wabaPool.ts
 * Role    : Drizzle ORM schema for waba_pool table.
 *           LynkBot-owned WABA accounts available for assignment to new tenants.
 *           access_token_enc is AES-256-GCM encrypted with WABA_POOL_ENCRYPTION_KEY.
 * Exports : wabaPool, wabaPoolStatusEnum
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const wabaPoolStatusEnum = pgEnum('waba_pool_status', [
  'available',
  'assigned',
  'suspended',
  'retired',
]);

export const wabaPool = pgTable(
  'waba_pool',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneNumberId: varchar('phone_number_id', { length: 50 }).notNull().unique(),
    displayPhone: varchar('display_phone', { length: 20 }).notNull(),
    wabaId: varchar('waba_id', { length: 255 }).notNull(),
    accessTokenEnc: text('access_token_enc').notNull(),
    status: wabaPoolStatusEnum('status').notNull().default('available'),
    assignedTo: uuid('assigned_to').references(() => tenants.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at'),
    qualityRating: varchar('quality_rating', { length: 10 }),
    messagingTier: integer('messaging_tier').notNull().default(1),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('waba_pool_status_idx').on(t.status),
    assignedToIdx: index('waba_pool_assigned_to_idx').on(t.assignedTo),
  }),
);
