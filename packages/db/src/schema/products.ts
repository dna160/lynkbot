/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/products.ts
 * Role    : Drizzle ORM schema for products table and knowledge_status enum
 * Imports : drizzle-orm/pg-core only
 * Exports : products, knowledgeStatusEnum
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
import { tenants } from './tenants';

export const knowledgeStatusEnum = pgEnum('knowledge_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 100 }),
  description: text('description'),
  tagline: varchar('tagline', { length: 500 }),
  targetReader: text('target_reader'),
  problemsSolved: jsonb('problems_solved').$type<string[]>(),
  keyOutcomes: jsonb('key_outcomes').$type<string[]>(),
  faqPairs: jsonb('faq_pairs').$type<Array<{ q: string; a: string }>>(),
  testimonials: jsonb('testimonials').$type<string[]>(),
  priceIdr: integer('price_idr').notNull(),
  weightGrams: integer('weight_grams').notNull().default(0),
  dimensionsCm: jsonb('dimensions_cm').$type<{ l: number; w: number; h: number }>(),
  coverImageUrl: text('cover_image_url'),
  pdfS3Key: text('pdf_s3_key'),
  knowledgeStatus: knowledgeStatusEnum('knowledge_status').default('pending'),
  bookPersonaPrompt: text('book_persona_prompt'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
