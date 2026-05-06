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
import { db, buyers, flowExecutions, eq, and, or, not } from '@lynkbot/db';
import { QUEUES } from '@lynkbot/shared';

interface BroadcastBatchData {
  tenantId: string;
  flowId: string;
  buyerIds: string[];
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
  const { tenantId, flowId, buyerIds } = job.data;

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

  for (const buyerId of buyerIds) {
    const buyer = buyerMap.get(buyerId);
    if (!buyer) continue;
    if (buyer.doNotContact) continue;
    if (runningBuyerIds.has(buyerId)) continue;

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

  console.log(
    `[broadcastBatchProcessor] Enqueued ${enqueued.length}/${buyerIds.length} individual flow jobs for flow=${flowId} tenant=${tenantId}`,
  );
}
