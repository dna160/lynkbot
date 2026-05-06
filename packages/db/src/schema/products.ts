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
  customType,
} from 'drizzle-orm/pg-core';

/** Native Postgres bytea column — maps to Node.js Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
  toDriver(value) { return value; },
  fromDriver(value) { return Buffer.isBuffer(value) ? value : Buffer.from(value as unknown as Uint8Array); },
});
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
  /** Raw PDF bytes stored when S3 is not configured (inline mode). Enables re-training without re-upload. */
  pdfBytes: bytea('pdf_bytes'),
  knowledgeStatus: knowledgeStatusEnum('knowledge_status').default('pending'),
  knowledgeError: text('knowledge_error'),
  bookPersonaPrompt: text('book_persona_prompt'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
