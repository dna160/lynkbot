/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/webhooks/meta.ts
 * Role    : Meta WhatsApp Cloud API webhook handler.
 *
 *   GET  /webhooks/meta  — Hub verification handshake (called once during setup).
 *                          Meta sends hub.mode, hub.challenge, hub.verify_token.
 *                          Must respond with hub.challenge as plain text.
 *
 *   POST /webhooks/meta  — Inbound messages and status updates.
 *                          Returns 200 IMMEDIATELY before async processing.
 *                          Meta retries on timeout or non-200.
 *
 * Exports : metaWebhookRoutes (Fastify plugin)
 * DO NOT  : Add business logic here — delegate to ConversationService
 */
import type { FastifyPluginAsync } from 'fastify';
import { verifyMetaSignature } from '../../middleware/metaSignature';
import { extractFirstMessage, isStatusUpdate } from '@lynkbot/meta';
import { config } from '../../config';
import { db, buyers, flowExecutions, staff, webhookIngestLog, eq, and, sql } from '@lynkbot/db';
import { TemplateStudioService } from '../../services/templateStudio.service';
import { RiskScoreService } from '../../services/riskScore.service';
import { SchedulingService } from '../../services/scheduling.service';
import { flowEngineSingleton as flowEngine } from '../../services/flowEngine.singleton';
import { getRedisConnection } from '../../config';
import { Queue } from 'bullmq';
import { QUEUES } from '@lynkbot/shared';

const templateStudioService = new TemplateStudioService();
const riskScoreService = new RiskScoreService();
const schedulingService = new SchedulingService();

// ── Webhook durability queue ─────────────────────────────────────────────────
const redisConn = getRedisConnection();
const webhookQueue = new Queue(QUEUES.WEBHOOK_PROCESS, { connection: redisConn });

function extractMetaMessageId(body: unknown): string | null {
  try {
    const b = body as Record<string, unknown>;
    const entry = Array.isArray(b.entry) ? b.entry[0] : undefined;
    const changes = (entry as any)?.changes;
    const firstChange = Array.isArray(changes) ? changes[0] : undefined;
    const value = (firstChange as any)?.value;
    const messages = value?.messages;
    const firstMessage = Array.isArray(messages) ? messages[0] : undefined;
    return firstMessage?.id ?? null;
  } catch {
    return null;
  }
}

export const metaWebhookRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /webhooks/meta
   * Meta hub verification — called when you first register the webhook URL
   * in the Meta Developer Console.
   *
   * Meta sends:
   *   ?hub.mode=subscribe
   *   &hub.challenge=<random-string>
   *   &hub.verify_token=<your-META_WEBHOOK_VERIFY_TOKEN>
   *
   * We must return hub.challenge as plain text with status 200.
   */
  fastify.get<{
    Querystring: {
      'hub.mode'?: string;
      'hub.challenge'?: string;
      'hub.verify_token'?: string;
    };
  }>(
    '/webhooks/meta',
    async (request, reply) => {
      const mode = request.query['hub.mode'];
      const challenge = request.query['hub.challenge'];
      const token = request.query['hub.verify_token'];

      request.log.info({ mode, token: token?.slice(0, 8) + '...' }, 'Meta webhook verification request');

      if (mode === 'subscribe' && token === config.META_WEBHOOK_VERIFY_TOKEN) {
        request.log.info('Meta webhook verified ✓');
        return reply.status(200).send(challenge);
      }

      request.log.warn({ mode, token }, 'Meta webhook verification failed — token mismatch');
      return reply.status(403).send({ error: 'Verification failed' });
    },
  );

  /**
   * POST /webhooks/meta
   * Receives inbound messages and delivery status updates.
   * Signature is verified by the metaSignature preHandler.
   * Returns 200 immediately, processes async.
   */
  fastify.post(
    '/webhooks/meta',
    { preHandler: verifyMetaSignature },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const metaMessageId = extractMetaMessageId(body);

      // ── Notification-type webhooks (field-based routing) ───────────────
      const entry = body?.entry;
      const firstEntry = Array.isArray(entry) ? entry[0] : undefined;
      const changes = (firstEntry as any)?.changes;
      const firstChange = Array.isArray(changes) ? changes[0] : undefined;
      const changeField = (firstChange as any)?.field as string | undefined;
      const changeValue = (firstChange as any)?.value;

      if (changeField === 'message_template_status_update') {
        const val = changeValue as Record<string, unknown>;
        templateStudioService
          .handleStatusUpdate({
            metaTemplateId: val?.message_template_id as string | number,
            event: val?.event as 'APPROVED' | 'REJECTED' | 'DISABLED' | 'FLAGGED' | 'IN_APPEAL' | 'REINSTATED',
            reason: val?.reason as string | undefined,
          })
          .catch((err: unknown) => request.log.error({ err }, 'Template status update failed'));
        return reply.status(200).send({ received: true });
      }

      if (changeField === 'phone_number_quality_update') {
        riskScoreService
          .handleQualityUpdate(changeValue as Record<string, unknown>)
          .catch((err: unknown) => request.log.error({ err }, 'Quality update handling failed'));
        return reply.status(200).send({ received: true });
      }

      // Skip status update callbacks
      if (isStatusUpdate(body)) {
        return reply.status(200).send({ received: true });
      }

      const payload = extractFirstMessage(body);
      if (!payload) {
        return reply.status(200).send({ received: true });
      }

      // ── Idempotency: log every inbound message ─────────────────────────
      if (metaMessageId) {
        try {
          const [log] = await db
            .insert(webhookIngestLog)
            .values({
              tenantId: null, // resolved by processor
              metaMessageId,
              phoneNumberId: payload.phoneNumberId,
              payload: body as any,
              status: 'pending',
            })
            .onConflictDoNothing()
            .returning({ id: webhookIngestLog.id });

          if (!log) {
            // Duplicate webhook — already processed or in-flight
            request.log.info({ metaMessageId }, 'Duplicate Meta webhook — returning 200');
            return reply.status(200).send({ received: true });
          }

          // Enqueue async processing
          await webhookQueue.add(
            'webhook.process',
            { logId: log.id },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: 100,
              removeOnFail: false,
            },
          );

          request.log.info(
            { waId: payload.waId, type: payload.messageType, msgId: payload.messageId, logId: log.id },
            'Meta inbound message queued for async processing',
          );
        } catch (logErr) {
          request.log.error({ err: logErr, metaMessageId }, 'Failed to log webhook — letting Meta retry');
          return reply.status(500).send({ error: 'Internal error' });
        }
      }

      return reply.status(200).send({ received: true });
    },
  );
};
