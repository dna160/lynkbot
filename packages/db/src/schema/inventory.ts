/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/inventory.ts
 * Role    : Drizzle ORM schema for inventory table
 * Imports : drizzle-orm/pg-core, ./products, ./tenants
 * Exports : inventory
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  uuid,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { products } from './products';
import { tenants } from './tenants';

export const inventory = pgTable('inventory', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  quantityAvailable: integer('quantity_available').notNull().default(0),
  quantityReserved: integer('quantity_reserved').notNull().default(0),
  quantitySold: integer('quantity_sold').notNull().default(0),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniqueProductTenant: unique().on(t.productId, t.tenantId),
}));
