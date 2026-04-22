/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/queues.ts
 * Role    : BullMQ Queue instance factory for enqueuing jobs from within worker context.
 *           Uses QUEUES constants from @lynkbot/shared.
 *           Maintains a singleton map so queue connections are reused across the process lifetime.
 * Exports : getQueue() function
 * DO NOT  : Create queue instances in processor files — use this factory.
 *           Import from apps/api or apps/dashboard.
 */
import { Queue } from 'bullmq';
import type { QueueName } from '@lynkbot/shared';

const queues = new Map<string, Queue>();

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

/**
 * Returns a singleton Queue instance for the given queue name.
 * Creates the Queue on first call; reuses the same connection thereafter.
 */
export function getQueue(name: QueueName): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: getRedisConnection(),
        defaultJobOptions: {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      }),
    );
  }
  return queues.get(name)!;
}

/**
 * Close all open queue connections. Call during graceful shutdown if needed.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
