/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/broadcastBatch.processor.ts
 * Role    : Process broadcast batches of up to 500 buyers each.
 *           Checks compliance (doNotContact, rate limit, cooldown) then
 *           enqueues individual flow execution jobs.
 */
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { db, buyers, flowExecutions, buyerBroadcastLog, eq, and, or, not, gte } from '@lynkbot/db';
import { QUEUES, logger } from '@lynkbot/shared';

interface BroadcastBatchData {
  tenantId: string;
  flowId: string;
  buyerIds: string[];
  templateName?: string;
  executionContext?: Record<string, unknown>;
}

const redisConnection = (() => {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
})();

const flowQueue = new Queue(QUEUES.FLOW_EXECUTION, { connection: redisConnection });

export async function broadcastBatchProcessor(job: Job<BroadcastBatchData>): Promise<void> {
  const { tenantId, flowId, buyerIds, templateName } = job.data;

  // Load buyer details for compliance checks
  const buyerRows = await db.query.buyers.findMany({
    where: and(eq(buyers.tenantId, tenantId), not(buyers.doNotContact)),
  });

  const buyerMap = new Map(buyerRows.map(b => [b.id, b]));

  // Check running executions for this flow
  const runningExecutions = await db.query.flowExecutions.findMany({
    where: and(
      eq(flowExecutions.flowId, flowId),
      or(
        eq(flowExecutions.status, 'running'),
        eq(flowExecutions.status, 'waiting_reply'),
      ),
    ),
    columns: { buyerId: true },
  });
  const runningBuyerIds = new Set(runningExecutions.map(e => e.buyerId));

  const enqueued: string[] = [];
  const skipped24h: string[] = [];
  const skippedCooldown: string[] = [];

  for (const buyerId of buyerIds) {
    const buyer = buyerMap.get(buyerId);
    if (!buyer) continue;
    if (buyer.doNotContact) continue;
    if (runningBuyerIds.has(buyerId)) continue;

    // 24h session window check (using updatedAt as proxy for last activity)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (buyer.updatedAt && buyer.updatedAt < twentyFourHoursAgo) {
      skipped24h.push(buyerId);
      continue;
    }

    // Template cooldown check (7 days same template to same buyer)
    if (templateName) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentBroadcast = await db.query.buyerBroadcastLog.findFirst({
        where: and(
          eq(buyerBroadcastLog.buyerId, buyerId),
          eq(buyerBroadcastLog.templateName, templateName),
          gte(buyerBroadcastLog.sentAt, sevenDaysAgo),
        ),
      });
      if (recentBroadcast) {
        skippedCooldown.push(buyerId);
        continue;
      }
    }

    await flowQueue.add(
      'flow.start_execution',
      {
        tenantId,
        flowId,
        buyerId,
        triggerType: 'broadcast',
      },
      { removeOnComplete: 100, removeOnFail: false },
    );
    enqueued.push(buyerId);
  }

  if (skipped24h.length > 0) {
    logger.info(`Skipped ${skipped24h.length} buyers (outside 24h window)`, { context: 'broadcastBatchProcessor' });
  }
  if (skippedCooldown.length > 0) {
    logger.info(`Skipped ${skippedCooldown.length} buyers (template cooldown)`, { context: 'broadcastBatchProcessor' });
  }

  logger.info(
    `Enqueued ${enqueued.length}/${buyerIds.length} individual flow jobs for flow=${flowId} tenant=${tenantId}`,
    { context: 'broadcastBatchProcessor', flowId, tenantId },
  );
}
