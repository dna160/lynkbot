/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/index.ts
 * Role    : BullMQ worker bootstrap. Registers all job processors.
 *           Includes DLQ config, health HTTP server, and graceful shutdown.
 * Exports : nothing (entry point)
 */
import { Worker } from 'bullmq';
import { QUEUES } from '@lynkbot/shared';
import { ingestProcessor } from './processors/ingest.processor';
import { trackingProcessor } from './processors/tracking.processor';
import { paymentExpiryProcessor } from './processors/paymentExpiry.processor';
import { stockReleaseProcessor } from './processors/stockRelease.processor';
import { restockProcessor } from './processors/restock.processor';
import { flowExecutionProcessor } from './processors/flowExecution.processor';
import { templateSyncProcessor } from './processors/templateSync.processor';
import { riskScoreProcessor } from './processors/riskScore.processor';
import { reminderProcessor } from './processors/reminder.processor';
import { webhookProcessor } from './processors/webhook.processor';
import { broadcastBatchProcessor } from './processors/broadcastBatch.processor';
import { createServer } from 'node:http';
import { redisConnection } from './redis';

const workers = [
  new Worker(QUEUES.INGEST, ingestProcessor, {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 300_000,
  }),
  new Worker(QUEUES.TRACKING, trackingProcessor, {
    connection: redisConnection,
    concurrency: 10,
  }),
  new Worker(QUEUES.PAYMENT_EXPIRY, paymentExpiryProcessor, {
    connection: redisConnection,
    concurrency: 5,
  }),
  new Worker(QUEUES.STOCK_RELEASE, stockReleaseProcessor, {
    connection: redisConnection,
    concurrency: 5,
  }),
  new Worker(QUEUES.RESTOCK_NOTIFY, restockProcessor, {
    connection: redisConnection,
    concurrency: 5,
  }),
  new Worker(QUEUES.FLOW_EXECUTION, flowExecutionProcessor, {
    connection: redisConnection,
    concurrency: 20,
    lockDuration: 60_000,
    limiter: { max: 1000, duration: 1000 },
  }),
  new Worker(QUEUES.TEMPLATE_SYNC, templateSyncProcessor, {
    connection: redisConnection,
    concurrency: 5,
  }),
  new Worker(QUEUES.RISK_SCORE, riskScoreProcessor, {
    connection: redisConnection,
    concurrency: 3,
  }),
  new Worker(QUEUES.REMINDERS, reminderProcessor, {
    connection: redisConnection,
    concurrency: 10,
  }),
  new Worker(QUEUES.WEBHOOK_PROCESS, webhookProcessor, {
    connection: redisConnection,
    concurrency: Number(process.env.WEBHOOK_PROCESS_CONCURRENCY ?? 10),
  }),
  new Worker(QUEUES.BROADCAST_BATCH, broadcastBatchProcessor, {
    connection: redisConnection,
    concurrency: 10,
  }),
];

workers.forEach((w) => {
  w.on('failed', (job, err) => {
    console.error(`[worker:${w.name}] Job ${job?.id} failed:`, err.message);
  });
  w.on('error', (err) => {
    console.error(`[worker:${w.name}] Worker error:`, err.message);
  });
  w.on('completed', (job) => {
    console.log(`[worker:${w.name}] Job ${job.id} completed`);
  });
});

console.log(`LynkBot Worker started — processing ${workers.length} queues: ${workers.map((w) => w.name).join(', ')}`);

// ── Health HTTP server ───────────────────────────────────────────────────────
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3001);

const healthServer = createServer((_req, res) => {
  const statuses = workers.map((w) => ({
    queue: w.name,
    isRunning: w.isRunning(),
  }));
  const allRunning = statuses.every((s) => s.isRunning);
  res.writeHead(allRunning ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: allRunning ? 'healthy' : 'degraded',
    workers: statuses,
  }));
});

healthServer.listen(healthPort, '0.0.0.0', () => {
  console.log(`Worker health server listening on port ${healthPort}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[${signal}] Graceful shutdown initiated — closing all workers...`);
  await Promise.all(workers.map((w) => w.close()));
  console.log('All workers closed.');
  healthServer.close(() => {
    console.log('Health server closed. Exiting.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
