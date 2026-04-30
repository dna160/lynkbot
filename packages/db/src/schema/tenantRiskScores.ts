/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/tenantRiskScores.ts
 * Role    : Drizzle ORM schema for tenant_risk_scores table.
 *           Score > 80 blocks activation/broadcast (PRD §17, non-overridable).
 * Exports : tenantRiskScores
 */
import {
  pgTable,
  uuid,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const tenantRiskScores = pgTable(
  'tenant_risk_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    factors: jsonb('factors').notNull().default({}),
    computedAt: timestamp('computed_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantUnique: uniqueIndex('tenant_risk_scores_tenant_unique').on(t.tenantId),
    tenantIdx: index('tenant_risk_scores_tenant_idx').on(t.tenantId, t.computedAt),
  }),
);
