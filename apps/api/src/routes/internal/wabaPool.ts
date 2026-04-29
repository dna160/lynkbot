import type { FastifyPluginAsync } from 'fastify';
import { internalApiKey } from '../../middleware/internalApiKey';
import { WabaPoolService } from '../../services/wabaPool.service';

const svc = new WabaPoolService();

export const internalWabaPoolRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /internal/waba-pool
   * List all pool accounts + assignment status.
   */
  fastify.get(
    '/internal/waba-pool',
    { preHandler: internalApiKey },
    async (_request, reply) => {
      const pool = await svc.listPool();
      return reply.send({ pool });
    },
  );

  /**
   * POST /internal/waba-pool
   * Add a new Meta-verified account to the pool.
   * Body: { phoneNumberId, displayPhone, wabaId, accessToken }
   */
  fastify.post(
    '/internal/waba-pool',
    { preHandler: internalApiKey },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const { phoneNumberId, displayPhone, wabaId, accessToken } = body;

      if (!phoneNumberId || !displayPhone || !wabaId || !accessToken) {
        return reply.status(400).send({ error: 'phoneNumberId, displayPhone, wabaId, and accessToken are required' });
      }

      await svc.addToPool({
        phoneNumberId: String(phoneNumberId),
        displayPhone: String(displayPhone),
        wabaId: String(wabaId),
        accessToken: String(accessToken),
      });

      return reply.status(201).send({ success: true });
    },
  );
};
