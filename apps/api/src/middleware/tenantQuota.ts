/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/middleware/tenantQuota.ts
 * Role    : Enforces resource quotas per subscription tier
 */
import { db, tenants, flowDefinitions, flowTemplates, staff as staffTable, products, eq, sql } from '@lynkbot/db';

const TIER_QUOTAS = {
  trial: { maxFlows: 1, maxTemplates: 1, maxStaff: 0, maxProducts: 5 },
  growth: { maxFlows: 10, maxTemplates: 20, maxStaff: 3, maxProducts: 50 },
  pro: { maxFlows: 50, maxTemplates: 100, maxStaff: 10, maxProducts: 200 },
  scale: { maxFlows: Infinity, maxTemplates: Infinity, maxStaff: Infinity, maxProducts: Infinity },
};

export type QuotaResource = 'flows' | 'templates' | 'staff' | 'products';

export async function checkQuota(tenantId: string, resource: QuotaResource): Promise<{ ok: boolean; limit: number; current: number }> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { subscriptionTier: true },
  });

  const tier = (tenant?.subscriptionTier ?? 'trial') as keyof typeof TIER_QUOTAS;
  const quota = TIER_QUOTAS[tier];

  const key = `max${resource.charAt(0).toUpperCase() + resource.slice(1)}` as keyof typeof quota;
  const limit = quota[key];

  if (limit === Infinity) {
    return { ok: true, limit: Infinity, current: 0 };
  }

  let current = 0;
  if (resource === 'flows') {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(flowDefinitions).where(eq(flowDefinitions.tenantId, tenantId));
    current = row?.count ?? 0;
  } else if (resource === 'templates') {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(flowTemplates).where(eq(flowTemplates.tenantId, tenantId));
    current = row?.count ?? 0;
  } else if (resource === 'staff') {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(staffTable).where(eq(staffTable.tenantId, tenantId));
    current = row?.count ?? 0;
  } else if (resource === 'products') {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId));
    current = row?.count ?? 0;
  }

  return { ok: current < limit, limit, current };
}

export function requireQuota(resource: QuotaResource) {
  return async (request: any, reply: any) => {
    const tenantId = request.user?.tenantId as string;
    if (!tenantId) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const result = await checkQuota(tenantId, resource);
    if (!result.ok) {
      return reply.status(403).send({
        error: 'quota_exceeded',
        message: `${resource} limit reached for your plan. Upgrade to create more.`,
        limit: result.limit,
        current: result.current,
      });
    }
  };
}
