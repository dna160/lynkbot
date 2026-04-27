/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/watiStatus.processor.ts
 * Role    : DEPRECATED — LynkBot now uses Meta Direct (no WATI Partner).
 *           This processor is a no-op stub retained to avoid breaking queue registrations.
 *           Remove when the WATI_WABA_STATUS queue is drained and purged.
 * Exports : watiStatusProcessor
 */
import type { Processor } from 'bullmq';
import { db, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';

export const watiStatusProcessor: Processor = async (job) => {
  const { tenantId } = job.data as { tenantId: string };

  job.log(`Meta Direct mode — WABA status polling is not needed. Marking tenant ${tenantId} as manual_required if still pending.`);

  // Safety net: if a tenant is still in 'registering' state (legacy), push to manual_required
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (tenant && tenant.watiAccountStatus === 'registering') {
    await db.update(tenants)
      .set({ watiAccountStatus: 'manual_required', updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    job.log(`Tenant ${tenantId} moved from 'registering' to 'manual_required' (Meta Direct migration)`);
  }

  return { skipped: true, reason: 'meta_direct_mode' };
};
