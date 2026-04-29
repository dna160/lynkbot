/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/buyerBroadcastLog.ts
 * Role    : Drizzle ORM schema for buyer_broadcast_log table.
 *           Cooldown tracker — same template to same buyer max 1× per 7 days
 *           (PRD §17, enforced by CooldownChecker in flow-engine).
 * Exports : buyerBroadcastLog
 */
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { buyers } from './buyers';
import { flowDefinitions } from './flowDefinitions';

export const buyerBroadcastLog = pgTable(
  'buyer_broadcast_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    templateName: varchar('template_name', { length: 255 }).notNull(),
    broadcastId: uuid('broadcast_id'),
    flowId: uuid('flow_id').references(() => flowDefinitions.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at').notNull().defaultNow(),
  },
  (t) => ({
    buyerIdx: index('buyer_broadcast_log_buyer_idx').on(t.buyerId, t.templateName, t.sentAt),
    tenantIdx: index('buyer_broadcast_log_tenant_idx').on(t.tenantId),
  }),
);
