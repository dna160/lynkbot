/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/internal/dlq.ts
 * Role    : Dead Letter Queue management routes
 *           Protected by x-api-key
 */
import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { QUEUES } from '@lynkbot/shared';
import { config, getRedisConnection } from '../../config';

const redisConn = getRedisConnection();

export const dlqRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (apiKey !== config.LYNK_INTERNAL_API_KEY) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  // GET /internal/dlq/stats — counts per queue
  fastify.get('/internal/dlq/stats', async (_request, reply) => {
    const queueNames = Object.values(QUEUES);
    const stats: Record<string, { failed: number; waiting: number; completed: number }> = {};

    for (const name of queueNames) {
      const q = new Queue(name, { connection: redisConn });
      const [failed, waiting, completed] = await Promise.all([
        q.getFailedCount(),
        q.getWaitingCount(),
        q.getCompletedCount(),
      ]);
      stats[name] = { failed, waiting, completed };
      await q.close();
    }

    return reply.send({ stats });
  });

  // POST /internal/dlq/retry — retry all failed jobs in a queue
  fastify.post('/internal/dlq/retry', async (request, reply) => {
    const { queueName } = request.body as { queueName: string };
    if (!Object.values(QUEUES).includes(queueName as any)) {
      return reply.status(400).send({ error: 'invalid_queue', message: `Queue ${queueName} does not exist` });
    }

    const q = new Queue(queueName, { connection: redisConn });
    const failedJobs = await q.getFailed();
    const retried: string[] = [];

    for (const job of failedJobs) {
      await job.retry();
      retried.push(job.id ?? 'unknown');
    }

    await q.close();
    return reply.send({ success: true, queue: queueName, retriedCount: retried.length, retried });
  });

  // POST /internal/dlq/retry/:jobId — retry specific job
  fastify.post('/internal/dlq/retry/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { queueName } = request.body as { queueName: string };

    if (!Object.values(QUEUES).includes(queueName as any)) {
      return reply.status(400).send({ error: 'invalid_queue', message: `Queue ${queueName} does not exist` });
    }

    const q = new Queue(queueName, { connection: redisConn });
    const job = await q.getJob(jobId);

    if (!job) {
      await q.close();
      return reply.status(404).send({ error: 'job_not_found' });
    }

    await job.retry();
    await q.close();
    return reply.send({ success: true, jobId, queue: queueName });
  });
};
