/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/productEmbeddings.ts
 * Role    : pgvector semantic search embeddings for product RAG
 * Imports : drizzle-orm/pg-core only
 * Exports : productEmbeddings
 */
import { pgTable, uuid, text, integer, timestamp, customType, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { products } from './products';

/** Custom vector type for pgvector (768 dimensions) */
const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(768)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value.replace(/\[|\]/g, '[').replace(/\s+/g, ','));
  },
});

export const productEmbeddings = pgTable(
  'product_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    chunkText: text('chunk_text').notNull(),
    embedding: vector768('embedding').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('product_embeddings_tenant_idx').on(table.tenantId),
  }),
);
