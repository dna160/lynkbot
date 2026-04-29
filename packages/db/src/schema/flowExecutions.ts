/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/flowExecutions.ts
 * Role    : Drizzle ORM schema for flow_executions table.
 *           One row per (flow, buyer) execution. The partial-unique index that
 *           enforces "max one running execution per (flow, buyer)" is owned by
 *           the SQL migration (0005_flow_engine.sql) — Drizzle's index DSL does
 *           not express partial-unique cleanly.
 * Exports : flowExecutions, flowExecutionStatusEnum
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { buyers } from './buyers';
import { flowDefinitions } from './flowDefinitions';

export const flowExecutionStatusEnum = pgEnum('flow_execution_status', [
  'running',
  'completed',
  'cancelled',
  'failed',
]);

export const flowExecutions = pgTable(
  'flow_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flowDefinitions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    status: flowExecutionStatusEnum('status').notNull().default('running'),
    currentNodeId: varchar('current_node_id', { length: 100 }),
    context: jsonb('context').notNull().default({}),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    failedAt: timestamp('failed_at'),
    cancelledAt: timestamp('cancelled_at'),
    lastStepAt: timestamp('last_step_at').notNull().defaultNow(),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    flowIdx: index('flow_executions_flow_idx').on(t.flowId),
    tenantIdx: index('flow_executions_tenant_idx').on(t.tenantId),
    buyerIdx: index('flow_executions_buyer_idx').on(t.buyerId),
    statusIdx: index('flow_executions_status_idx').on(t.status),
    // NOTE: partial-unique index `flow_executions_running_unique` on (flow_id, buyer_id)
    // WHERE status = 'running' is created in 0005_flow_engine.sql.
  }),
);
