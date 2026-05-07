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
import { db, buyers, flowExecutions, staff, eq, and, sql } from '@lynkbot/db';
import { FlowEngine } from '@lynkbot/flow-engine';
import { getTenantMetaClient } from '../../services/_meta.helper';
import { getRedisConnection } from '../../config';
import Redis from 'ioredis';
import { TemplateStudioService } from '../../services/templateStudio.service';
import { RiskScoreService } from '../../services/riskScore.service';
import { SchedulingService } from '../../services/scheduling.service';

const conversationService = new ConversationService();
const templateStudioService = new TemplateStudioService();
const riskScoreService = new RiskScoreService();
const schedulingService = new SchedulingService();

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

        // ── Staff intercept — HIGHEST PRIORITY ────────────────────────────
        // If the inbound WA number matches a staff record, this is a staff
        // member replying to a confirmation template — NOT a buyer message.
        // Staff always wins: even if a staff number has a buyer row, we route
        // to the scheduling confirmation handler and return immediately.
        // Decision: "Staff always wins" — see session notes 2026-05-xx.
        {
          const inboundText = payload.text ?? payload.raw?.text?.body ?? '';
          const staffMember = await db.query.staff.findFirst({
            where: and(eq(staff.tenantId, tenantId), eq(staff.phoneNumber, payload.waId)),
            columns: { id: true, phoneNumber: true },
          });

          if (staffMember) {
            request.log.info(
              { waId: payload.waId, staffId: staffMember.id, tenantId },
              'Staff intercept: routing to scheduling confirmation handler',
            );

            // Path A: quick-reply button from aria_appointment_confirmation template
            const buttonPayload = payload.raw?.interactive?.button_reply?.id as string | undefined;
            if (buttonPayload?.startsWith('appt:')) {
              // Format: "appt:<appointmentId>:confirm" | "appt:<appointmentId>:decline"
              const [, appointmentId, action] = buttonPayload.split(':');
              const isConfirm = action === 'confirm';
              schedulingService
                .handleStaffButtonReply(tenantId, appointmentId, isConfirm, request.log)
                .catch((err: unknown) =>
                  request.log.error({ err, appointmentId }, 'Staff button reply handling failed'),
                );
            } else if (buttonPayload?.startsWith('appt_reschedule_')) {
              // Format: "appt_reschedule_approve:<appointmentId>" | "appt_reschedule_reject:<appointmentId>"
              const isApprove = buttonPayload.startsWith('appt_reschedule_approve:');
              const appointmentId = buttonPayload.split(':')[1];
              schedulingService
                .handleStaffRescheduleApproval(appointmentId, tenantId, isApprove, request.log)
                .catch((err: unknown) =>
                  request.log.error({ err, appointmentId }, 'Staff reschedule approval handling failed'),
                );
            } else if (inboundText) {
              // Path B: keyword reply (konfirmasi / tolak / etc.)
              schedulingService
                .handleStaffKeywordReply(tenantId, staffMember.id, staffMember.phoneNumber, inboundText, request.log)
                .catch((err: unknown) =>
                  request.log.error({ err, staffId: staffMember.id }, 'Staff keyword reply handling failed'),
                );
            }

            return; // Do NOT process as buyer message
          }
        }

        // ── Find-or-create buyer (needed for all flow engine checks below) ──
        // Do this once here so button trigger, waiting_reply resume, and keyword
        // trigger all use the same row — and keyword trigger works even on a
        // buyer's very first message (before ConversationService creates them).
        let inboundBuyer = await db.query.buyers.findFirst({
          where: and(eq(buyers.waPhone, payload.waId), eq(buyers.tenantId, tenantId)),
          columns: { id: true },
        });
        if (!inboundBuyer) {
          const [created] = await db
            .insert(buyers)
            .values({
              tenantId,
              waPhone: payload.waId,
              displayName: payload.name ?? null,
              preferredLanguage: 'id',
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [buyers.waPhone, buyers.tenantId],
              set: { updatedAt: sql`now()` },
            })
            .returning({ id: buyers.id });
          inboundBuyer = created;
        }

        // ── Flow Engine: button trigger routing ────────────────────────────
        const interactiveButtonId =
          payload.messageType === 'interactive'
            ? (payload.raw?.interactive?.button_reply?.id ?? payload.raw?.interactive?.list_reply?.id)
            : payload.messageType === 'button'
            ? payload.raw?.button?.payload
            : undefined;

        if (typeof interactiveButtonId === 'string' && interactiveButtonId.startsWith('flow:')) {
          flowEngine
            .handleButtonTrigger(tenantId, inboundBuyer.id, interactiveButtonId)
            .catch((err: unknown) =>
              request.log.error({ err }, 'Flow button trigger failed'),
            );
          return;
        }

        // ── Flow Engine: resume WAIT_FOR_REPLY ─────────────────────────────
        // Wrapped in try-catch: if the flow_execution_status enum is missing
        // 'waiting_reply' (migration 0009 not yet applied), we must NOT crash
        // here — fall through to ConversationService instead.
        let resumedByFlowEngine = false;
        try {
          const activeExecution = await db.query.flowExecutions.findFirst({
            where: and(
              eq(flowExecutions.tenantId, tenantId),
              eq(flowExecutions.buyerId, inboundBuyer.id),
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
            resumedByFlowEngine = true;
          }
        } catch (flowErr: unknown) {
          request.log.warn({ err: flowErr }, 'Flow engine resume check failed — falling through to ConversationService');
        }

        if (resumedByFlowEngine) {
          // Still persist the buyer's reply so it appears in the dashboard conversation thread.
          // skipAI=true because the flow engine is handling the response — LLM must not fire.
          conversationService.handleInbound(tenantId, payload, { skipAI: true }).catch(err => {
            request.log.error({ err, tenantId, waId: payload.waId }, 'Error saving resumed-flow inbound message');
          });
          return;
        }

        // ── Flow Engine: inbound_keyword trigger ───────────────────────────
        // Runs after waiting_reply (active execution takes priority over new trigger).
        // We trigger the flow but do NOT return — ConversationService must still
        // run so the message is saved to the conversations table (dashboard visibility).
        // skipAI=true when triggered — routeByState (LLM) is bypassed.
        const inboundText = payload.text ?? payload.raw?.text?.body ?? '';
        let keywordTriggered = false;
        if (inboundText) {
          request.log.info(
            { tenantId, waId: payload.waId, inboundText },
            'Checking inbound_keyword flows',
          );
          try {
            keywordTriggered = await flowEngine.handleKeywordTrigger(
              tenantId,
              inboundBuyer.id,
              inboundText,
            );
            request.log.info(
              { tenantId, waId: payload.waId, inboundText, keywordTriggered },
              keywordTriggered
                ? 'Keyword flow triggered — LLM will be skipped'
                : 'No keyword flow matched — falling through to ConversationService',
            );
          } catch (kwErr: unknown) {
            request.log.warn({ err: kwErr, inboundText }, 'Keyword trigger check failed — falling through to ConversationService');
          }
        } else {
          request.log.debug(
            { tenantId, waId: payload.waId, messageType: payload.messageType },
            'Non-text message — skipping keyword trigger check',
          );
        }

        // ── Always run ConversationService to save the message to the DB ───
        // skipAI=true when a flow was triggered — message is persisted for
        // the dashboard but routeByState is bypassed (flow sends the reply).
        conversationService.handleInbound(tenantId, payload, { skipAI: keywordTriggered }).catch(err => {
          request.log.error({ err, tenantId, waId: payload.waId }, 'Error processing Meta inbound message');
        });
      } catch (err) {
        request.log.error({ err, body: request.body }, 'Failed to process Meta webhook');
      }
    },
  );
};
