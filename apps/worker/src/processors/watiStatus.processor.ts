/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/watiStatus.processor.ts
 * Role    : Polls WATI Partner API for WABA account status updates.
 *           Updates tenant record when account becomes active.
 * Job data: { tenantId: string, watiAccountId: string, attempt: number, maxAttempts: number }
 */
import type { Processor } from 'bullmq';
import { db, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { WatiPartnerClient } from '@lynkbot/wati';

export const watiStatusProcessor: Processor = async (job) => {
  const { tenantId, watiAccountId, attempt, maxAttempts } = job.data as {
    tenantId: string;
    watiAccountId: string;
    attempt: number;
    maxAttempts: number;
  };

  job.log(`Polling WATI status for tenant ${tenantId}, account ${watiAccountId} (attempt ${attempt + 1}/${maxAttempts})`);

  const client = new WatiPartnerClient(
    process.env.WATI_API_KEY!,
    process.env.WATI_PARTNER_BASE_URL,
  );

  const status = await client.getAccountStatus(watiAccountId);
  job.log(`WATI account status: ${status.status}`);

  if (status.status === 'active' && status.wabaId) {
    await db.update(tenants)
      .set({
        wabaId: status.wabaId,
        watiAccountStatus: 'active',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
    job.log(`Tenant ${tenantId} WATI account activated`);
    return { activated: true };
  }

  if (status.status === 'rejected' || status.status === 'failed') {
    await db.update(tenants)
      .set({
        watiAccountStatus: 'manual_required',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
    job.log(`Tenant ${tenantId} WATI account rejected — switched to manual_required`);
    return { activated: false, reason: 'rejected' };
  }

  if (attempt >= maxAttempts - 1) {
    await db.update(tenants)
      .set({
        watiAccountStatus: 'manual_required',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
    job.log(`Tenant ${tenantId} max attempts reached — switched to manual_required`);
    return { activated: false, reason: 'max_attempts' };
  }

  // Still pending — throw to trigger BullMQ retry
  throw new Error(`WATI account status still "${status.status}" — will retry`);
};
