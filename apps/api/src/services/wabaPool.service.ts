import { db, wabaPool, tenants, eq, sql } from '@lynkbot/db';
import { config } from '../config';
import { encrypt, decrypt } from '../utils/crypto';

export class WabaPoolService {
  /**
   * Atomically pick the next available pool account and assign it to the tenant.
   * Runs inside a transaction with SKIP LOCKED so concurrent onboardings don't
   * race to the same pool row.
   */
  async assignToTenant(
    tenantId: string,
  ): Promise<{ assigned: true; phoneNumberId: string } | { assigned: false; reason: 'pool_exhausted' }> {
    return db.transaction(async (tx) => {
      // Lock one available row atomically; SKIP LOCKED avoids blocking on concurrent onboardings
      const available = await tx.execute<typeof wabaPool.$inferSelect>(
        sql`SELECT * FROM waba_pool WHERE status = 'available' LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );

      const rows = Array.isArray(available) ? available : (available as any).rows ?? [];
      if (!rows.length) {
        return { assigned: false, reason: 'pool_exhausted' } as const;
      }

      const pool = rows[0] as typeof wabaPool.$inferSelect;
      const now = new Date();

      await tx
        .update(wabaPool)
        .set({ status: 'assigned', assignedTo: tenantId, assignedAt: now })
        .where(eq(wabaPool.id, pool.id));

      await tx
        .update(tenants)
        .set({
          metaPhoneNumberId: pool.phoneNumberId,
          wabaId: pool.wabaId,
          metaAccessToken: pool.accessTokenEnc, // already encrypted at rest
          watiAccountStatus: 'active',
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));

      return { assigned: true, phoneNumberId: pool.phoneNumberId } as const;
    });
  }

  async releaseFromTenant(tenantId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(wabaPool)
        .set({ status: 'available', assignedTo: null, assignedAt: null })
        .where(eq(wabaPool.assignedTo, tenantId));

      await tx
        .update(tenants)
        .set({ metaPhoneNumberId: null, wabaId: null, metaAccessToken: null, watiAccountStatus: 'manual_required', updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
    });
  }

  async listPool(): Promise<Array<{
    id: string;
    phoneNumberId: string;
    displayPhone: string;
    wabaId: string;
    status: string;
    assignedTo: string | null;
    assignedAt: Date | null;
  }>> {
    const rows = await db.select({
      id: wabaPool.id,
      phoneNumberId: wabaPool.phoneNumberId,
      displayPhone: wabaPool.displayPhone,
      wabaId: wabaPool.wabaId,
      status: wabaPool.status,
      assignedTo: wabaPool.assignedTo,
      assignedAt: wabaPool.assignedAt,
    }).from(wabaPool);
    return rows;
  }

  async addToPool(input: {
    phoneNumberId: string;
    displayPhone: string;
    wabaId: string;
    accessToken: string;
  }): Promise<void> {
    const accessTokenEnc = encrypt(input.accessToken, config.WABA_POOL_ENCRYPTION_KEY);
    await db.insert(wabaPool).values({
      phoneNumberId: input.phoneNumberId,
      displayPhone: input.displayPhone,
      wabaId: input.wabaId,
      accessTokenEnc,
      status: 'available',
    }).onConflictDoNothing();
  }

  /** Decrypt a pool token for use in MetaClient */
  decryptToken(encryptedToken: string): string {
    return decrypt(encryptedToken, config.WABA_POOL_ENCRYPTION_KEY);
  }
}
