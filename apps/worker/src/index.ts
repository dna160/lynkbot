/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/index.ts
 * Role    : BullMQ worker bootstrap. Registers all job processors.
 *           No HTTP server — pure background job runner.
 *           Graceful SIGTERM shutdown closes all workers before exit.
 * Exports : nothing (entry point)
 * DO NOT  : Expose HTTP routes. Import from apps/api or apps/dashboard.
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

// Parse REDIS_URL if provided (preferred over individual vars)
function getRedisConnection() {
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
}

const redisConnection = getRedisConnection();

const workers = [
  // lockDuration: 5 min — ingest involves PDF parse + LLM (reasoning model can take 60s+).
  // Default 30s causes BullMQ to mark jobs stalled and re-queue them, keeping status 'processing' forever.
  new Worker(QUEUES.INGEST,         ingestProcessor,        { connection: redisConnection, concurrency: 2, lockDuration: 300_000 }),
  new Worker(QUEUES.TRACKING,       trackingProcessor,      { connection: redisConnection, concurrency: 10 }),
  new Worker(QUEUES.PAYMENT_EXPIRY, paymentExpiryProcessor, { connection: redisConnection, concurrency: 5 }),
  new Worker(QUEUES.STOCK_RELEASE,  stockReleaseProcessor,  { connection: redisConnection, concurrency: 5 }),
  new Worker(QUEUES.RESTOCK_NOTIFY, restockProcessor,       { connection: redisConnection, concurrency: 5 }),
  // Flow Engine — Phase 2
  new Worker(QUEUES.FLOW_EXECUTION, flowExecutionProcessor,  { connection: redisConnection, concurrency: 20, lockDuration: 60_000 }),
  // Template Studio — Phase 3
  new Worker(QUEUES.TEMPLATE_SYNC, templateSyncProcessor, { connection: redisConnection, concurrency: 5 }),
  // Risk Scoring — Phase 4
  new Worker(QUEUES.RISK_SCORE, riskScoreProcessor, { connection: redisConnection, concurrency: 3 }),
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

async function shutdown(): Promise<void> {
  console.log('Graceful shutdown initiated — closing all workers...');
  await Promise.all(workers.map((w) => w.close()));
  console.log('All workers closed. Exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
