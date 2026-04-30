/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/riskScore.ts
 * Role    : Risk score routes — PRD §11.4.
 *           GET  /v1/risk-score          → tenant risk score + breakdown (recomputed if >1h old)
 *           POST /v1/risk-score/compute  → force recompute
 * Exports : riskScoreRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { RiskScoreService } from '../../services/riskScore.service';

const riskScoreService = new RiskScoreService();

export const riskScoreRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/risk-score
   * Returns the tenant's current risk score and factor breakdown.
   * If the stored score is older than 1 hour, it is synchronously recomputed first.
   *
   * Response:
   *   { score, breakdown, computedAt, level: 'ok'|'warning'|'blocked' }
   */
  fastify.get(
    '/v1/risk-score',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const result = await riskScoreService.getForTenant(tenantId);

      const level =
        result.score > 80 ? 'blocked' :
        result.score > 60 ? 'warning' : 'ok';

      return reply.send({ ...result, level });
    },
  );

  /**
   * POST /v1/risk-score/compute
   * Forces a full recomputation of the tenant risk score from live DB data.
   * Returns the freshly computed score and breakdown.
   */
  fastify.post(
    '/v1/risk-score/compute',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const result = await riskScoreService.computeAndStore(tenantId);

      const level =
        result.score > 80 ? 'blocked' :
        result.score > 60 ? 'warning' : 'ok';

      return reply.send({ ...result, level });
    },
  );
};
