/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/flowDefinitions.ts
 * Role    : Drizzle ORM schema for flow_definitions table.
 *           A flow_definition is the canonical, versioned graph of nodes/edges
 *           that the Flow Engine executes.
 * Exports : flowDefinitions, flowStatusEnum
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const flowStatusEnum = pgEnum('flow_status', ['draft', 'active', 'paused', 'archived']);

export const flowDefinitions = pgTable(
  'flow_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: flowStatusEnum('status').notNull().default('draft'),
    triggerType: varchar('trigger_type', { length: 50 }).notNull(),
    triggerConfig: jsonb('trigger_config').notNull().default({}),
    definition: jsonb('definition').notNull(),
    validationErrors: jsonb('validation_errors').$type<string[]>().default([]),
    version: integer('version').notNull().default(1),
    generatedByAi: boolean('generated_by_ai').notNull().default(false),
    aiPrompt: text('ai_prompt'),
    activatedAt: timestamp('activated_at'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('flow_definitions_tenant_idx').on(t.tenantId),
    statusIdx: index('flow_definitions_status_idx').on(t.status),
    triggerTypeIdx: index('flow_definitions_trigger_type_idx').on(t.triggerType),
  }),
);
