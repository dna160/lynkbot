/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/intentPlaybooks.ts
 * Role    : Intent Playbook table — per-tenant configurable AI behavior per conversation intent.
 *           Each row defines how the AI should behave when a specific intent is detected,
 *           what to inject into the system prompt, and what next step to direct the buyer toward.
 * Exports : intentKeyEnum, nextStepTypeEnum, intentPlaybooks
 * DO NOT  : Import from apps/*, packages except @lynkbot/shared and drizzle-orm
 */
import { pgTable, uuid, varchar, text, boolean, integer, jsonb, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const intentKeyEnum = pgEnum('intent_key', [
  'GREETING',
  'BROWSING',
  'PRODUCT_INQUIRY',
  'OBJECTION_HANDLING',
  'CHECKOUT_INTENT',
  'OUT_OF_STOCK',
  'WANTS_CONSULTATION',
  'GENERAL_INQUIRY',
]);

export const nextStepTypeEnum = pgEnum('next_step_type', [
  'continue_conversation',
  'checkout',
  'schedule_consultation',
  'human_handoff',
  'collect_info',
]);

export const intentPlaybooks = pgTable('intent_playbooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  intentKey: intentKeyEnum('intent_key').notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  priority: integer('priority').notNull().default(0),
  // What to add to the AI system prompt when this intent fires
  systemPromptAddition: text('system_prompt_addition').notNull().default(''),
  // Optional hint to AI about tone/persona for this intent
  toneNote: text('tone_note'),
  // What happens next after the AI responds
  nextStepType: nextStepTypeEnum('next_step_type').notNull().default('continue_conversation'),
  // Flexible config for the next step (e.g. consultation type, duration, link)
  nextStepConfig: jsonb('next_step_config').$type<Record<string, unknown>>(),
  // Keywords that hint this intent is active (for future auto-detection)
  detectionKeywords: jsonb('detection_keywords').$type<string[]>(),
  // Fallback message if AI fails entirely
  fallbackMessage: text('fallback_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('intent_playbooks_tenant_idx').on(t.tenantId),
  tenantIntentIdx: index('intent_playbooks_tenant_intent_idx').on(t.tenantId, t.intentKey),
}));
