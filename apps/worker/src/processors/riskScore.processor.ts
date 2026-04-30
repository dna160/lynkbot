/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/riskScore.processor.ts
 * Role    : BullMQ processor for RISK_SCORE queue.
 *           Handles risk.compute jobs — recomputes tenant risk score from live DB data.
 *           Cannot import from apps/api — implements computation inline using @lynkbot/db
 *           and @lynkbot/flow-engine directly.
 * Exports : riskScoreProcessor
 */
import type { Processor } from 'bullmq';
import {
  db,
  tenants,
  tenantRiskScores,
  buyerBroadcastLog,
  flowTemplates,
  buyers,
  eq,
  and,
  gte,
  not,
  count,
} from '@lynkbot/db';
import { computeRiskScore } from '@lynkbot/flow-engine';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function statusToQualityScore(status: string): number {
  switch (status) {
    case 'approved': return 1;
    case 'pending_review':
    case 'in_appeal': return 0.5;
    default: return 0;
  }
}

async function computeRiskForTenant(tenantId: string): Promise<void> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  const [broadcastRow] = await db
    .select({ cnt: count() })
    .from(buyerBroadcastLog)
    .where(
      and(
        eq(buyerBroadcastLog.tenantId, tenantId),
        gte(buyerBroadcastLog.sentAt, sevenDaysAgo),
      ),
    );
  const broadcastsSent7d = Number(broadcastRow?.cnt ?? 0);

  const [totalBuyersRow] = await db
    .select({ cnt: count() })
    .from(buyers)
    .where(eq(buyers.tenantId, tenantId));
  const totalBuyers = Number(totalBuyersRow?.cnt ?? 0);

  const [optInRow] = await db
    .select({ cnt: count() })
    .from(buyers)
    .where(
      and(
        eq(buyers.tenantId, tenantId),
        not(buyers.doNotContact),
        gte(buyers.totalOrders, 1),
      ),
    );
  const buyersWithInboundHistory = Number(optInRow?.cnt ?? 0);

  const tenantTemplates = await db.query.flowTemplates.findMany({
    where: eq(flowTemplates.tenantId, tenantId),
    columns: { status: true },
  });

  let averageTemplateQualityScore = 1;
  if (tenantTemplates.length > 0) {
    const qualitySum = tenantTemplates.reduce(
      (sum, t) => sum + statusToQualityScore(t.status),
      0,
    );
    averageTemplateQualityScore = qualitySum / tenantTemplates.length;
  }

  const badCount = tenantTemplates.filter(
    t => t.status === 'rejected' || t.status === 'disabled' || t.status === 'flagged',
  ).length;
  const noReplyRate7d = tenantTemplates.length > 0 ? badCount / tenantTemplates.length : 0;

  const { score, breakdown } = computeRiskScore({
    broadcastsSent7d,
    uniqueOptedInBuyers: buyersWithInboundHistory,
    averageTemplateQualityScore,
    noReplyRate7d,
    buyersWithInboundHistory,
    totalBuyers,
    averageDelayBetweenNodesMs: 500,
  });

  // Delete old row then insert (no unique constraint on tenant_id in schema)
  await db.delete(tenantRiskScores).where(eq(tenantRiskScores.tenantId, tenantId));
  await db.insert(tenantRiskScores).values({
    tenantId,
    score,
    factors: breakdown as unknown as Record<string, unknown>,
    computedAt: now,
  });

  await db
    .update(tenants)
    .set({ lastRiskScoreAt: now })
    .where(eq(tenants.id, tenantId));

  console.log(`[riskScoreProcessor] Computed score=${score} for tenant=${tenantId}`);
}

export const riskScoreProcessor: Processor = async (job) => {
  const { name, data } = job;

  if (name === 'risk.compute') {
    const tenantId = data?.tenantId as string | undefined;

    if (tenantId) {
      // Single-tenant compute
      await computeRiskForTenant(tenantId);
    } else {
      // All-tenants sweep — called by hourly cron
      const allTenants = await db.query.tenants.findMany({
        columns: { id: true },
      });
      for (const t of allTenants) {
        await computeRiskForTenant(t.id).catch((err) =>
          console.error(`[riskScoreProcessor] Failed for tenant=${t.id}:`, err),
        );
      }
    }
  } else {
    console.warn(`[riskScoreProcessor] Unknown job name: ${name}`);
  }
};
