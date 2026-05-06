/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/productChunks.ts
 * Role    : Drizzle ORM schema for product_chunks table with pgvector support
 *           Uses customType for the vector column (dimensions: 1536).
 *           HNSW index must be created via raw SQL migration (see 0000_initial.sql).
 * Imports : drizzle-orm/pg-core, ./products, ./tenants
 * Exports : productChunks
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { products } from './products';
import { tenants } from './tenants';

export const productChunks = pgTable('product_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  contentText: text('content_text').notNull(),
  chapterTitle: text('chapter_title'),
  pageNumber: integer('page_number'),
  chunkIndex: integer('chunk_index').notNull(),
  tokenCount: integer('token_count').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
