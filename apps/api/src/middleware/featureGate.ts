import type { FastifyRequest, FastifyReply } from 'fastify';

export type FeatureFlag =
  | 'flow_builder'
  | 'template_studio'
  | 'flow_reengagement'
  | 'ai_flow_generator'
  | 'risk_score';

/**
 * Stub middleware for subscription-tier feature gating (PRD §2.7).
 * Business rules are not yet finalized — all authenticated tenants pass.
 * When rules are known, edit only this file; no route changes needed.
 */
export function requireFeature(_feature: FeatureFlag) {
  return async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    // TODO: implement real tier checks when business rules are finalized.
  };
}
