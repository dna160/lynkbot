/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/index.ts
 * Role    : Re-exports db client and all schema tables
 * Imports : ./client, ./schema
 * Exports : db, pgClient, all table definitions
 * DO NOT  : Import from apps/* or non-db packages except @lynkbot/shared
 */
export { db, pgClient } from './client';
export type { DB } from './client';
export * from './schema';
// Re-export drizzle helpers so packages that depend on @lynkbot/db don't need their own drizzle-orm copy
export { eq, and, or, not, sql, inArray, isNull, isNotNull, desc, asc, count, sum, avg, max, min, gt, gte, lt, lte, ne, like, ilike, between, notInArray, exists, notExists } from 'drizzle-orm';
