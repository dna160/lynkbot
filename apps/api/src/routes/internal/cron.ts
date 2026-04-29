/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/internal/cron.ts
 * Role    : Seeds BullMQ repeatable jobs for Flow Engine cron tasks (PRD §12.4).
 *           Protected by X-Internal-Api-Key header.
 *
 *   POST /internal/flows/seed-cron
 *
 * Jobs seeded:
 *   - flow.check_time_triggers  every 15 min  → FLOW_EXECUTION queue
 *   - template.poll_pending     every 5 min   → TEMPLATE_SYNC queue  (Phase 3)
 *   - template.sync_quality     every 60 min  → TEMPLATE_SYNC queue  (Phase 3)
 *
 * Exports : internalCronRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { QUEUES } from '@lynkbot/shared';
import { internalApiKey } from '../../middleware/internalApiKey';
import { getRedisConnection } from '../../config';

export const internalCronRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/internal/flows/seed-cron',
    { preHandler: internalApiKey },
    async (_request, reply) => {
      const redisConn = getRedisConnection();

      const flowQueue = new Queue(QUEUES.FLOW_EXECUTION, { connection: redisConn });
      const templateQueue = new Queue(QUEUES.TEMPLATE_SYNC, { connection: redisConn });

      // Remove existing repeatable jobs to avoid duplicates
      const existingFlowRepeatables = await flowQueue.getRepeatableJobs();
      for (const job of existingFlowRepeatables) {
        if (job.name === 'flow.check_time_triggers') {
          await flowQueue.removeRepeatableByKey(job.key);
        }
      }

      const existingTemplateRepeatables = await templateQueue.getRepeatableJobs();
      for (const job of existingTemplateRepeatables) {
        if (
          job.name === 'template.poll_pending' ||
          job.name === 'template.sync_quality'
        ) {
          await templateQueue.removeRepeatableByKey(job.key);
        }
      }

      // Seed: flow.check_time_triggers — every 15 minutes
      await flowQueue.add(
        'flow.check_time_triggers',
        { triggeredBy: 'seed-cron' },
        {
          repeat: { every: 15 * 60 * 1000 }, // 15 minutes in ms
          jobId: 'cron:flow.check_time_triggers',
        },
      );

      // Seed: template.poll_pending — every 5 minutes (Phase 3 uses this)
      await templateQueue.add(
        'template.poll_pending',
        { triggeredBy: 'seed-cron' },
        {
          repeat: { every: 5 * 60 * 1000 }, // 5 minutes in ms
          jobId: 'cron:template.poll_pending',
        },
      );

      // Seed: template.sync_quality — every 60 minutes (Phase 3 uses this)
      await templateQueue.add(
        'template.sync_quality',
        { triggeredBy: 'seed-cron' },
        {
          repeat: { every: 60 * 60 * 1000 }, // 60 minutes in ms
          jobId: 'cron:template.sync_quality',
        },
      );

      await flowQueue.close();
      await templateQueue.close();

      return reply.send({
        success: true,
        seeded: [
          { queue: QUEUES.FLOW_EXECUTION, job: 'flow.check_time_triggers', every: '15m' },
          { queue: QUEUES.TEMPLATE_SYNC, job: 'template.poll_pending', every: '5m' },
          { queue: QUEUES.TEMPLATE_SYNC, job: 'template.sync_quality', every: '60m' },
        ],
      });
    },
  );
};
