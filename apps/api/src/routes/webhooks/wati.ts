/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/webhooks/wati.ts
 * Role    : Inbound WhatsApp message webhook handler.
 *           Returns 200 IMMEDIATELY before processing (WATI retries on timeout).
 *           Processes message async via ConversationService.
 *           Applies HMAC signature verification preHandler.
 * Exports : watiWebhookRoutes (Fastify plugin)
 * DO NOT  : Add business logic here — delegate to ConversationService
 */
import type { FastifyPluginAsync } from 'fastify';
import { verifyWatiSignature } from '../../middleware/watiSignature';
import { parseWebhook } from '@lynkbot/wati';
import { ConversationService } from '../../services/conversation.service';

const conversationService = new ConversationService();

export const watiWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { tenantId: string } }>(
    '/webhooks/wati/:tenantId',
    {
      preHandler: verifyWatiSignature,
    },
    async (request, reply) => {
      const { tenantId } = request.params;
      const raw = request.body as Record<string, unknown>;

      // WATI fires webhooks for both inbound (buyer) and outbound (operator) messages.
      // owner: true = buyer sent it (process it). owner: false = operator sent it (skip).
      if (raw?.owner === false) {
        return reply.status(200).send({ received: true, skipped: 'operator_message' });
      }

      request.log.info({ tenantId, waId: raw?.waId }, 'WATI inbound message received');

      // Return 200 immediately — WATI retries on 5xx or timeout
      reply.status(200).send({ received: true });

      // Process async (do not await reply)
      try {
        const payload = parseWebhook(request.body);
        conversationService.handleInbound(tenantId, payload).catch(err => {
          request.log.error({ err, tenantId }, 'Error processing inbound WA message');
        });
      } catch (err) {
        request.log.error({ err, rawBody: request.body, tenantId }, 'Failed to parse WATI webhook payload');
      }
    }
  );
};
