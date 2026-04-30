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
import { ConversationService } from '../../services/conversation.service';
import { config } from '../../config';
import { db, buyers, flowExecutions, eq, and } from '@lynkbot/db';
import { FlowEngine } from '@lynkbot/flow-engine';
import { getTenantMetaClient } from '../../services/_meta.helper';
import { getRedisConnection } from '../../config';
import Redis from 'ioredis';
import { TemplateStudioService } from '../../services/templateStudio.service';
import { RiskScoreService } from '../../services/riskScore.service';

const conversationService = new ConversationService();
const templateStudioService = new TemplateStudioService();
const riskScoreService = new RiskScoreService();

// ── Flow Engine singleton ────────────────────────────────────────────────────
// Instantiated once per API process; matches ConversationService pattern.
const redisConn = getRedisConnection();
const redisClientForFlowEngine = new Redis(redisConn);
const flowEngine = new FlowEngine({
  getMetaClient: getTenantMetaClient,
  redisClient: redisClientForFlowEngine,
  redisConnection: redisConn,
});

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
      // Return 200 immediately — Meta retries on 5xx or timeout
      reply.status(200).send({ received: true });

      try {
        // ── Notification-type webhooks (field-based routing) ───────────────
        const entry = (request.body as Record<string, unknown>)?.entry;
        const firstEntry = Array.isArray(entry) ? entry[0] : undefined;
        const changes = (firstEntry as Record<string, unknown>)?.changes;
        const firstChange = Array.isArray(changes) ? changes[0] : undefined;
        const changeField = (firstChange as Record<string, unknown>)?.field as string | undefined;
        const changeValue = (firstChange as Record<string, unknown>)?.value;

        if (changeField === 'message_template_status_update') {
          // Template approval/rejection/disabled events from Meta
          const val = changeValue as Record<string, unknown>;
          templateStudioService
            .handleStatusUpdate({
              metaTemplateId: val?.message_template_id as string | number,
              event: val?.event as 'APPROVED' | 'REJECTED' | 'DISABLED' | 'FLAGGED' | 'IN_APPEAL' | 'REINSTATED',
              reason: val?.reason as string | undefined,
            })
            .catch((err: unknown) =>
              request.log.error({ err }, 'Template status update failed'),
            );
          return; // 200 already sent
        }

        if (changeField === 'phone_number_quality_update') {
          // Quality rating change — update tenant.wabaQualityRating + recompute risk score
          riskScoreService
            .handleQualityUpdate(changeValue as Record<string, unknown>)
            .catch((err: unknown) =>
              request.log.error({ err }, 'Quality update handling failed'),
            );
          return; // 200 already sent
        }

        // Skip status update callbacks (sent/delivered/read for our own outbound messages)
        if (isStatusUpdate(request.body)) {
          return;
        }

        const payload = extractFirstMessage(request.body);
        if (!payload) {
          // No actionable message (could be a notification we don't handle)
          return;
        }

        request.log.info(
          { waId: payload.waId, type: payload.messageType, msgId: payload.messageId },
          'Meta inbound message received',
        );

        // Look up tenantId from phone_number_id — the Meta phone number identifies the tenant
        const tenantId = await conversationService.resolveTenantByPhoneNumberId(payload.phoneNumberId);
        if (!tenantId) {
          request.log.warn(
            { phoneNumberId: payload.phoneNumberId },
            'No tenant found for Meta phone_number_id — ignoring',
          );
          return;
        }

        // ── Flow Engine: button trigger routing ────────────────────────────
        // Extract button payload from raw interactive message
        const interactiveButtonId =
          payload.messageType === 'interactive'
            ? (payload.raw?.interactive?.button_reply?.id ?? payload.raw?.interactive?.list_reply?.id)
            : payload.messageType === 'button'
            ? payload.raw?.button?.payload
            : undefined;

        if (typeof interactiveButtonId === 'string' && interactiveButtonId.startsWith('flow:')) {
          // Resolve buyer id from waId + tenantId
          const triggerBuyer = await db.query.buyers.findFirst({
            where: and(eq(buyers.waPhone, payload.waId), eq(buyers.tenantId, tenantId)),
            columns: { id: true },
          });

          if (triggerBuyer) {
            flowEngine
              .handleButtonTrigger(tenantId, triggerBuyer.id, interactiveButtonId)
              .catch((err: unknown) =>
                request.log.error({ err }, 'Flow button trigger failed'),
              );
          }
          // Return — do NOT also route through ConversationService for button triggers
          return;
        }

        // ── Flow Engine: resume WAIT_FOR_REPLY ─────────────────────────────
        const resumeBuyer = await db.query.buyers.findFirst({
          where: and(eq(buyers.waPhone, payload.waId), eq(buyers.tenantId, tenantId)),
          columns: { id: true },
        });

        if (resumeBuyer) {
          const activeExecution = await db.query.flowExecutions.findFirst({
            where: and(
              eq(flowExecutions.tenantId, tenantId),
              eq(flowExecutions.buyerId, resumeBuyer.id),
              // Note: flowExecutionStatusEnum may not include 'waiting_reply' in current schema
              // Using a cast here; Phase 1 migration adds this status
              eq(flowExecutions.status, 'waiting_reply'),
            ),
            columns: { id: true },
          });

          if (activeExecution) {
            const inboundText = payload.text ?? payload.raw?.text?.body ?? '';
            flowEngine
              .resumeExecution(activeExecution.id, inboundText)
              .catch((err: unknown) =>
                request.log.error({ err }, 'Flow resume failed'),
              );
            // Return — do NOT also route through ConversationService
            return;
          }
        }

        // ── Fall through to ConversationService for non-flow messages ──────
        conversationService.handleInbound(tenantId, payload).catch(err => {
          request.log.error({ err, tenantId, waId: payload.waId }, 'Error processing Meta inbound message');
        });
      } catch (err) {
        request.log.error({ err, body: request.body }, 'Failed to process Meta webhook');
      }
    },
  );
};
