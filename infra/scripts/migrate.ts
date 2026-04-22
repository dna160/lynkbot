/**
 * @CLAUDE_CONTEXT
 * Package : infra
 * File    : scripts/migrate.ts
 * Role    : Runs Drizzle Kit migrations. Run before deploying new service versions.
 *           Usage: pnpm --filter @lynkbot/db run migrate
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, pgClient } from '@lynkbot/db';
import path from 'path';

async function main() {
  console.log('🗄️  Running LynkBot database migrations...');
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../packages/db/src/migrations'),
  });
  console.log('✅ Migrations complete');
  await pgClient.end();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
