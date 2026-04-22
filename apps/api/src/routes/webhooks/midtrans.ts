/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/webhooks/midtrans.ts
 * Role    : Inbound Midtrans payment webhook handler.
 *           Returns 200 IMMEDIATELY before processing.
 *           Applies Midtrans signature verification preHandler.
 *           Delegates to PaymentService.handleMidtransWebhook() async.
 * Exports : midtransWebhookRoutes (Fastify plugin)
 * DO NOT  : Add payment logic here — delegate to PaymentService
 */
import type { FastifyPluginAsync } from 'fastify';
import { verifyMidtransSignature } from '../../middleware/paymentSignature';
import { PaymentService } from '../../services/payment.service';

const paymentService = new PaymentService();

export const midtransWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/webhooks/midtrans',
    {
      preHandler: verifyMidtransSignature,
    },
    async (request, reply) => {
      // Return 200 immediately — Midtrans retries on non-2xx
      reply.status(200).send({ received: true });

      // Process async
      // Signature already verified by preHandler middleware — pass empty string to bypass re-check
      paymentService.handlePaymentWebhook('midtrans', request.body as Record<string, unknown>, '').catch((err: unknown) => {
        request.log.error({ err }, 'Error processing Midtrans webhook');
      });
    }
  );
};
