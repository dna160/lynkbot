/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : drizzle.config.ts
 * Role    : Drizzle Kit configuration for migrations and schema generation
 * Exports : default Config
 * DO NOT  : Import from apps/* or packages except drizzle-kit
 */
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/*',
  out: './src/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
} satisfies Config;
