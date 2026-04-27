/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/webhooks/wati.ts
 * Role    : DEPRECATED — LynkBot now uses Meta WhatsApp Cloud API directly.
 *           This route stub is retained to avoid breaking any legacy integrations
 *           but returns 410 Gone. Remove after confirming no traffic on this path.
 * Exports : watiWebhookRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';

export const watiWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { tenantId: string } }>(
    '/webhooks/wati/:tenantId',
    async (_request, reply) => {
      return reply.status(410).send({
        error: 'WATI webhook endpoint deprecated — LynkBot now uses Meta WhatsApp Cloud API',
        migratedTo: '/webhooks/meta',
      });
    }
  );
};
