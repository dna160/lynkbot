/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/webhook.processor.ts
 * Role    : Process Meta webhook payloads asynchronously from webhook_ingest_log.
 *           Provides idempotency, retry, and durability guarantees.
 */
import type { Job } from 'bullmq';
import { db, webhookIngestLog, eq } from '@lynkbot/db';
import { processWebhookPayload } from '../services/webhookMessage.processor';

export async function webhookProcessor(job: Job<{ logId: string }>): Promise<void> {
  const log = await db.query.webhookIngestLog.findFirst({
    where: eq(webhookIngestLog.id, job.data.logId),
  });

  if (!log || log.status === 'completed') {
    return; // Already processed or missing
  }

  await db
    .update(webhookIngestLog)
    .set({ status: 'processing' })
    .where(eq(webhookIngestLog.id, job.data.logId));

  try {
    const payload = log.payload as Record<string, unknown>;
    await processWebhookPayload(payload);

    await db
      .update(webhookIngestLog)
      .set({ status: 'completed', processedAt: new Date() })
      .where(eq(webhookIngestLog.id, job.data.logId));
  } catch (err) {
    await db
      .update(webhookIngestLog)
      .set({ status: 'failed', errorMessage: String(err) })
      .where(eq(webhookIngestLog.id, job.data.logId));
    throw err; // Let BullMQ retry
  }
}
