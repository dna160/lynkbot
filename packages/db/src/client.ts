/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/client.ts
 * Role    : PostgreSQL connection pool via postgres.js + Drizzle ORM client
 * Imports : drizzle-orm, postgres, ./schema
 * Exports : db (Drizzle client), pgClient (raw postgres client for raw SQL)
 * DO NOT  : Import from apps/* or non-db packages except @lynkbot/shared
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const pgClient = postgres(process.env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(pgClient, { schema });
export type DB = typeof db;
