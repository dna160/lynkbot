import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

/**
 * Validates X-Internal-Api-Key header against LYNK_INTERNAL_API_KEY env var.
 * Used on /internal/* routes (ops-facing, not user-facing).
 */
export async function internalApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = request.headers['x-internal-api-key'];
  if (!key || key !== config.LYNK_INTERNAL_API_KEY) {
    return reply.status(401).send({ error: 'Invalid internal API key' });
  }
}
