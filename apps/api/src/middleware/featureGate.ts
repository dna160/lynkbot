import type { FastifyRequest, FastifyReply } from 'fastify';
import { db, tenants, eq } from '@lynkbot/db';

export type FeatureFlag =
  | 'flow_builder'
  | 'template_studio'
  | 'flow_reengagement'
  | 'ai_flow_generator'
  | 'risk_score'
  | 'scheduling';

const TIER_FEATURES = {
  trial: ['flow_builder'],
  growth: ['flow_builder', 'template_studio', 'flow_reengagement', 'risk_score'],
  pro: ['flow_builder', 'template_studio', 'flow_reengagement', 'risk_score', 'ai_flow_generator', 'scheduling'],
  scale: ['*'] as string[], // all
};

export function requireFeature(feature: FeatureFlag) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const tenantId = (request as any).user?.tenantId as string | undefined;
    if (!tenantId) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Authentication required' });
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { subscriptionTier: true },
    });

    const tier = tenant?.subscriptionTier ?? 'trial';
    const allowed = TIER_FEATURES[tier as keyof typeof TIER_FEATURES] ?? [];

    if (!allowed.includes('*') && !allowed.includes(feature)) {
      const requiredTier = (Object.entries(TIER_FEATURES) as [string, string[]][]).find(([, f]) =>
        f.includes('*') || f.includes(feature),
      )?.[0];

      return reply.status(403).send({
        error: 'feature_not_available',
        message: `Feature '${feature}' is not available on your ${tier} plan. Upgrade to access it.`,
        requiredTier,
      });
    }
  };
}
