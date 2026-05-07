/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/internal/admin.ts
 * Role    : Admin superpanel routes — tenant management, metrics, impersonation
 *           Protected by x-api-key + optional admin JWT check
 */
import type { FastifyPluginAsync } from 'fastify';
import { db, tenants, flowExecutions, messages, broadcasts, eq, sql, desc, gte } from '@lynkbot/db';
import { Queue } from 'bullmq';
import { QUEUES } from '@lynkbot/shared';
import { config, getRedisConnection } from '../../config';

const redisConn = getRedisConnection();

function isAdmin(request: any): boolean {
  return request.user?.role === 'admin' || request.headers['x-api-key'] === config.LYNK_INTERNAL_API_KEY;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.status(403).send({ error: 'admin_only', message: 'Admin access required' });
    }
  });

  // List tenants with health metrics
  fastify.get('/internal/admin/tenants', async (_request, reply) => {
    const tenantList = await db.query.tenants.findMany({
      columns: {
        id: true,
        storeName: true,
        subscriptionTier: true,
        metaPhoneNumberId: true,
        wabaQualityRating: true,
        createdAt: true,
      },
      orderBy: desc(tenants.createdAt),
    });

    // Enrich with last message time
    const enriched = await Promise.all(
      tenantList.map(async (t) => {
        const lastMsg = await db.query.messages.findFirst({
          where: eq(messages.tenantId, t.id),
          orderBy: desc(messages.createdAt),
          columns: { createdAt: true },
        });
        return {
          ...t,
          lastMessageAt: lastMsg?.createdAt ?? null,
        };
      }),
    );

    return reply.send({ tenants: enriched });
  });

  // Pause all flows for a tenant
  fastify.post('/internal/admin/tenants/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .update(flowExecutions)
      .set({ status: 'cancelled' })
      .where(eq(flowExecutions.tenantId, id));
    return reply.send({ success: true, tenantId: id, message: 'All running flows cancelled' });
  });

  // Impersonate tenant (return JWT for debugging)
  fastify.get('/internal/admin/tenants/:id/impersonate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, id),
      columns: { id: true, lynkUserId: true },
    });

    if (!tenant) {
      return reply.status(404).send({ error: 'tenant_not_found' });
    }

    const token = fastify.jwt.sign({
      tenantId: tenant.id,
      lynkUserId: tenant.lynkUserId,
    });

    return reply.send({ token, tenantId: tenant.id });
  });

  // DLQ overview
  fastify.get('/internal/admin/dlq', async (_request, reply) => {
    const queueNames = Object.values(QUEUES);
    const stats: Record<string, { failed: number }> = {};

    for (const name of queueNames) {
      const q = new Queue(name, { connection: redisConn });
      const failed = await q.getFailedCount();
      stats[name] = { failed };
      await q.close();
    }

    return reply.send({ dlq: stats });
  });

  // System metrics
  fastify.get('/internal/admin/metrics', async (_request, reply) => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [msgCountHour, msgCountDay, broadcastCountDay, activeExecutions] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(messages).where(gte(messages.createdAt, oneHourAgo)),
      db.select({ count: sql<number>`count(*)` }).from(messages).where(gte(messages.createdAt, oneDayAgo)),
      db.select({ count: sql<number>`count(*)` }).from(broadcasts).where(gte(broadcasts.createdAt, oneDayAgo)),
      db.select({ count: sql<number>`count(*)` }).from(flowExecutions).where(eq(flowExecutions.status, 'running')),
    ]);

    return reply.send({
      messagesPerHour: msgCountHour[0]?.count ?? 0,
      messagesPerDay: msgCountDay[0]?.count ?? 0,
      broadcastsPerDay: broadcastCountDay[0]?.count ?? 0,
      activeFlowExecutions: activeExecutions[0]?.count ?? 0,
    });
  });
};
