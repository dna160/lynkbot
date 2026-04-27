/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/migrate.ts
 * Role    : Runs Drizzle SQL migrations against the connected Postgres DB at
 *           server startup. Idempotent — safe to run on every deploy.
 *           Reads migration files from packages/db/src/migrations/.
 * Exports : runMigrations()
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { pgClient } from '@lynkbot/db';

// __dirname at runtime = /app/apps/api/dist
// packages live at      /app/packages/db/src/migrations
const MIGRATIONS_DIR = join(
  __dirname,
  '../../../packages/db/src/migrations'
);

const MIGRATIONS_TABLE = 'schema_migrations';

export async function runMigrations(): Promise<void> {
  const sql = pgClient;

  // Ensure migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(MIGRATIONS_TABLE)} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // List all .sql files, sorted so they apply in order
  let files: string[];
  try {
    const all = await readdir(MIGRATIONS_DIR);
    files = all.filter(f => f.endsWith('.sql')).sort();
  } catch (err) {
    console.warn('[migrate] Could not read migrations dir:', err);
    return;
  }

  for (const file of files) {
    // Skip already-applied migrations
    const [row] = await sql`
      SELECT filename FROM ${sql(MIGRATIONS_TABLE)} WHERE filename = ${file}
    `;
    if (row) continue;

    const filePath = join(MIGRATIONS_DIR, file);
    const migrationSql = await readFile(filePath, 'utf8');

    console.log(`[migrate] Applying ${file}…`);
    // Run each migration inside a transaction
    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSql);
      await tx`
        INSERT INTO ${tx(MIGRATIONS_TABLE)} (filename) VALUES (${file})
      `;
    });
    console.log(`[migrate] ✓ ${file} applied`);
  }

  console.log('[migrate] All migrations up to date');
}
