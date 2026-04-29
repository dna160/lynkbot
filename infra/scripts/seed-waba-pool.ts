/**
 * Seed the waba_pool table with pre-provisioned Meta WABA accounts.
 * Run once after migration 0005 on first deploy:
 *   WABA_POOL_ENCRYPTION_KEY=<key> pnpm seed:waba
 *
 * Each entry requires a Meta-verified System User access token, phone number ID,
 * and WABA ID from Meta Business Manager → WhatsApp → API Setup.
 */
import { db, wabaPool } from '@lynkbot/db';
import { encrypt } from '../../apps/api/src/utils/crypto';

const KEY = process.env.WABA_POOL_ENCRYPTION_KEY;
if (!KEY || !/^[0-9a-fA-F]{64}$/.test(KEY)) {
  console.error('WABA_POOL_ENCRYPTION_KEY must be set to a 64-char hex string. Generate with: openssl rand -hex 32');
  process.exit(1);
}

// ─── Replace TODOs with real credentials before running ───────────────────────
const POOL_ACCOUNTS = [
  // { phoneNumberId: 'TODO', displayPhone: '+628TODO', wabaId: 'TODO', accessToken: 'EAAx...' },
  // { phoneNumberId: 'TODO', displayPhone: '+628TODO', wabaId: 'TODO', accessToken: 'EAAx...' },
  // { phoneNumberId: 'TODO', displayPhone: '+628TODO', wabaId: 'TODO', accessToken: 'EAAx...' },
  // { phoneNumberId: 'TODO', displayPhone: '+628TODO', wabaId: 'TODO', accessToken: 'EAAx...' },
  // { phoneNumberId: 'TODO', displayPhone: '+628TODO', wabaId: 'TODO', accessToken: 'EAAx...' },
] as Array<{ phoneNumberId: string; displayPhone: string; wabaId: string; accessToken: string }>;
// ─────────────────────────────────────────────────────────────────────────────

if (POOL_ACCOUNTS.length === 0) {
  console.error('No accounts configured. Fill in POOL_ACCOUNTS before running this script.');
  process.exit(1);
}

for (const account of POOL_ACCOUNTS) {
  const accessTokenEnc = encrypt(account.accessToken, KEY);
  await db.insert(wabaPool).values({
    phoneNumberId: account.phoneNumberId,
    displayPhone: account.displayPhone,
    wabaId: account.wabaId,
    accessTokenEnc,
    status: 'available',
  }).onConflictDoNothing();
  console.log(`Seeded pool account: ${account.displayPhone}`);
}

console.log('WABA pool seeded successfully.');
process.exit(0);
