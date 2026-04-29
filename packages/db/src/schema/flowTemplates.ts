/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/flowTemplates.ts
 * Role    : Drizzle ORM schema for flow_templates table.
 *           Tenant-authored WhatsApp templates submitted to Meta for approval.
 *           Compliance: appealCount >= 2 blocks further appeals (PRD §17).
 * Exports : flowTemplates, flowTemplateStatusEnum
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const flowTemplateStatusEnum = pgEnum('flow_template_status', [
  'draft',
  'pending_submission',
  'submitted',
  'approved',
  'rejected',
  'paused',
  'disabled',
]);

export const flowTemplates = pgTable(
  'flow_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    language: varchar('language', { length: 10 }).notNull().default('id'),
    status: flowTemplateStatusEnum('status').notNull().default('draft'),
    bodyText: text('body_text').notNull(),
    header: jsonb('header'),
    footer: varchar('footer', { length: 60 }),
    buttons: jsonb('buttons').default([]),
    variables: jsonb('variables').$type<string[]>().default([]),
    metaTemplateId: varchar('meta_template_id', { length: 255 }),
    metaTemplateName: varchar('meta_template_name', { length: 255 }),
    rejectionReason: text('rejection_reason'),
    appealCount: integer('appeal_count').notNull().default(0),
    lastAppealedAt: timestamp('last_appealed_at'),
    submittedAt: timestamp('submitted_at'),
    approvedAt: timestamp('approved_at'),
    rejectedAt: timestamp('rejected_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('flow_templates_tenant_idx').on(t.tenantId),
    statusIdx: index('flow_templates_status_idx').on(t.status),
    tenantNameLangUnique: unique('flow_templates_tenant_name_lang_unique').on(
      t.tenantId,
      t.name,
      t.language,
    ),
  }),
);
