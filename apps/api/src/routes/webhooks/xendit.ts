/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/webhooks/xendit.ts
 * Role    : Inbound Xendit payment webhook handler.
 *           Returns 200 IMMEDIATELY before processing.
 *           Applies Xendit x-callback-token verification preHandler.
 *           Delegates to PaymentService.handleXenditWebhook() async.
 * Exports : xenditWebhookRoutes (Fastify plugin)
 * DO NOT  : Add payment logic here — delegate to PaymentService
 */
import type { FastifyPluginAsync } from 'fastify';
import { verifyXenditSignature } from '../../middleware/paymentSignature';
import { PaymentService } from '../../services/payment.service';

const paymentService = new PaymentService();

export const xenditWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/webhooks/xendit',
    {
      preHandler: verifyXenditSignature,
    },
    async (request, reply) => {
      // Return 200 immediately — Xendit retries on non-2xx
      reply.status(200).send({ received: true });

      // Process async
      // Signature already verified by preHandler middleware — pass empty string to bypass re-check
      paymentService.handlePaymentWebhook('xendit', request.body as Record<string, unknown>, '').catch((err: unknown) => {
        request.log.error({ err }, 'Error processing Xendit webhook');
      });
    }
  );
};
