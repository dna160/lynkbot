/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/templateSync.processor.ts
 * Role    : BullMQ processor for TEMPLATE_SYNC queue.
 *           Handles 'template.poll_pending' and 'template.sync_quality' jobs.
 *           Logic mirrors TemplateStudioService — implemented inline because
 *           workers cannot import from apps/api (separate deployable).
 * Exports : templateSyncProcessor (Processor)
 */
import type { Processor } from 'bullmq';
import axios from 'axios';
import { createDecipheriv } from 'node:crypto';
import { db, flowTemplates, flowDefinitions, tenants, eq, and, sql } from '@lynkbot/db';

// Inline AES-256-GCM decrypt — same algorithm as apps/api/src/utils/crypto.ts
function decrypt(bundled: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const buf = Buffer.from(bundled, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const ENCRYPTION_KEY = process.env.WABA_POOL_ENCRYPTION_KEY ?? '';

const statusMap: Record<string, typeof flowTemplates.$inferSelect['status']> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending_review',
  FLAGGED: 'flagged',
  IN_APPEAL: 'in_appeal',
  DISABLED: 'disabled',
};

async function pollPending(): Promise<void> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const pending = await db
    .select()
    .from(flowTemplates)
    .where(
      and(
        eq(flowTemplates.status, 'pending_review'),
        sql`${flowTemplates.submittedAt} < ${tenMinutesAgo.toISOString()}`,
      ),
    );

  for (const template of pending) {
    try {
      if (!template.metaTemplateId) continue;

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, template.tenantId),
      });
      if (!tenant?.metaAccessToken) continue;

      const accessToken = decrypt(tenant.metaAccessToken, ENCRYPTION_KEY);

      const res = await axios.get(
        `https://graph.facebook.com/v23.0/${template.metaTemplateId}`,
        {
          params: { fields: 'id,name,status,quality_score' },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: null,
        },
      );

      if (res.status !== 200) continue;

      const data = res.data as { status?: string };
      const metaStatus = data.status?.toUpperCase();
      const newStatus = metaStatus ? statusMap[metaStatus] : undefined;

      if (newStatus && newStatus !== template.status) {
        const updates: Partial<typeof flowTemplates.$inferInsert> = {
          status: newStatus,
          updatedAt: new Date(),
        };
        if (newStatus === 'approved') updates.approvedAt = new Date();
        if (newStatus === 'rejected') updates.rejectedAt = new Date();

        await db.update(flowTemplates).set(updates).where(eq(flowTemplates.id, template.id));
      }
    } catch {
      // Continue — don't abort on individual failures
    }
  }
}

async function syncQualityRatings(): Promise<void> {
  const approved = await db
    .select()
    .from(flowTemplates)
    .where(eq(flowTemplates.status, 'approved'));

  for (const template of approved) {
    try {
      if (!template.metaTemplateId) continue;

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, template.tenantId),
      });
      if (!tenant?.metaAccessToken) continue;

      const accessToken = decrypt(tenant.metaAccessToken, ENCRYPTION_KEY);

      const res = await axios.get(
        `https://graph.facebook.com/v23.0/${template.metaTemplateId}`,
        {
          params: { fields: 'id,name,status,quality_score' },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: null,
        },
      );

      if (res.status !== 200) continue;

      const data = res.data as { status?: string };
      const metaStatus = data.status?.toUpperCase();

      if (metaStatus && metaStatus !== 'APPROVED') {
        const newStatus = statusMap[metaStatus];
        if (!newStatus) continue;

        const now = new Date();
        await db
          .update(flowTemplates)
          .set({ status: newStatus, updatedAt: now })
          .where(eq(flowTemplates.id, template.id));

        // DISABLED → pause all active flows referencing this template
        if (newStatus === 'disabled') {
          const affectedFlows = await db
            .select({ id: flowDefinitions.id, description: flowDefinitions.description })
            .from(flowDefinitions)
            .where(
              and(
                eq(flowDefinitions.status, 'active'),
                sql`${flowDefinitions.definition}::text ILIKE ${'%' + template.name + '%'}`,
              ),
            );

          for (const flow of affectedFlows) {
            const pauseNote = `[Auto-paused ${now.toISOString()}] Template '${template.name}' was DISABLED by Meta.`;
            await db
              .update(flowDefinitions)
              .set({
                status: 'archived',
                description: flow.description ? `${flow.description}\n${pauseNote}` : pauseNote,
                updatedAt: now,
              })
              .where(eq(flowDefinitions.id, flow.id));
          }
        }
      }
    } catch {
      // Continue — don't abort on individual failures
    }
  }
}

export const templateSyncProcessor: Processor = async (job) => {
  if (job.name === 'template.poll_pending') {
    await pollPending();
  } else if (job.name === 'template.sync_quality') {
    await syncQualityRatings();
  }
};
