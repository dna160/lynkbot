/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/broadcasts.ts
 * Role    : Broadcast management — list templates (from Meta API), create broadcast, send to buyer list.
 *           Broadcasts use MetaClient.sendTemplate() only (compliance: never freeform outbound).
 *           Templates are fetched live from Meta's approved list — not hardcoded.
 * Exports : broadcastRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from '@lynkbot/db';
import { db, buyers, broadcasts } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { config } from '../../config';

/** Pause execution for ms milliseconds — used to rate-limit Meta API sends. */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const broadcastRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/broadcasts/templates
   * Fetches the live list of Meta-approved message templates from the WABA.
   * Templates are managed in Meta Business Manager — only APPROVED ones are returned.
   * Falls back to empty list if META_WABA_ID is not configured.
   */
  fastify.get(
    '/v1/broadcasts/templates',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      if (!config.META_WABA_ID || !config.META_ACCESS_TOKEN) {
        return reply.send({ templates: [], warning: 'META_WABA_ID or META_ACCESS_TOKEN not configured' });
      }

      try {
        const meta = new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
        const approved = await meta.listTemplates(config.META_WABA_ID);

        // Derive positional params from body component text using {{N}} placeholders
        const templates = approved.map(t => {
          const body = t.components.find(c => c.type === 'BODY');
          const params = body?.text
            ? [...(body.text.matchAll(/\{\{(\d+)\}\}/g))].map(m => `param${m[1]}`)
            : [];
          return {
            key: t.name,
            name: t.name,
            language: t.language,
            category: t.category,
            params,
          };
        });

        return reply.send({ templates });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error({ err }, 'Failed to fetch Meta templates');
        return reply.status(502).send({ error: `Failed to fetch templates from Meta: ${msg}` });
      }
    },
  );

  /**
   * GET /v1/broadcasts
   * List past broadcasts for this tenant.
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/v1/broadcasts',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      const rows = await db.select().from(broadcasts)
        .where(eq(broadcasts.tenantId, tenantId))
        .orderBy(desc(broadcasts.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({ items: rows, page, limit });
    },
  );

  /**
   * POST /v1/broadcasts
   * Create and immediately send a broadcast using an approved Meta template.
   *
   * Body: { templateKey, parameters: string[], audienceFilter?: { tags?: string[] } }
   *
   * Sends to all buyers for this tenant with doNotContact=false
   * (or filtered by tag). Rate-limited at ~80 req/min to stay within Meta limits.
   *
   * Response is sent immediately; actual delivery happens async in the background.
   */
  fastify.post<{
    Body: {
      templateKey: string;
      parameters: string[];
      audienceFilter?: { tags?: string[] };
    }
  }>(
    '/v1/broadcasts',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { templateKey, parameters = [], audienceFilter } = request.body ?? {};

      if (!templateKey) {
        return reply.status(400).send({ error: 'templateKey is required' });
      }

      if (!config.META_ACCESS_TOKEN || !config.META_PHONE_NUMBER_ID) {
        return reply.status(503).send({ error: 'WhatsApp not configured — META_ACCESS_TOKEN or META_PHONE_NUMBER_ID missing' });
      }

      // Fetch audience — include tags in select so tag filtering works
      const audienceRows = await db
        .select({ id: buyers.id, waPhone: buyers.waPhone, tags: buyers.tags })
        .from(buyers)
        .where(and(
          eq(buyers.tenantId, tenantId),
          eq(buyers.doNotContact, false),
        ));

      // Apply tag filter if provided
      let audience = audienceRows;
      if (audienceFilter?.tags?.length) {
        const filterTags = audienceFilter.tags;
        audience = audienceRows.filter(b => {
          const buyerTags: string[] = Array.isArray(b.tags) ? (b.tags as string[]) : [];
          return filterTags.some(t => buyerTags.includes(t));
        });
      }

      if (audience.length === 0) {
        return reply.status(422).send({ error: 'No eligible recipients found' });
      }

      // Create broadcast record
      const [broadcast] = await db.insert(broadcasts).values({
        tenantId,
        templateName: templateKey,
        templateParams: parameters,
        audienceFilter: audienceFilter ?? null,
        recipientCount: audience.length,
        status: 'sending',
      }).returning();

      // Respond immediately — send happens in the background
      reply.send({
        id: broadcast.id,
        recipientCount: audience.length,
        status: 'sending',
        message: `Sending to ${audience.length} contacts`,
      });

      // ── Background send ────────────────────────────────────────────────────
      // Rate limit: ~80 messages/min (750ms between sends) to stay well within
      // Meta's 1000 msg/min tier-1 limit and avoid burst errors.
      const meta = new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
      let sentCount = 0;
      let failedCount = 0;
      const errorLog: string[] = [];

      const components = parameters.length > 0
        ? [{ type: 'body' as const, parameters: parameters.map(p => ({ type: 'text' as const, text: p })) }]
        : [];

      for (const recipient of audience) {
        try {
          // Normalise phone: Meta expects E.164 without '+' (e.g. "628123456789")
          const to = recipient.waPhone.replace(/^\+/, '');
          await meta.sendTemplate({
            to,
            templateName: templateKey,
            languageCode: 'id',
            components,
          });
          sentCount++;
        } catch (err: unknown) {
          failedCount++;
          const msg = err instanceof Error ? err.message : String(err);
          errorLog.push(`${recipient.waPhone}: ${msg}`);
          fastify.log.warn({ phone: recipient.waPhone, err }, 'Broadcast send failed for recipient');
        }

        // 750ms delay between sends ≈ 80/min
        if (audience.indexOf(recipient) < audience.length - 1) {
          await sleep(750);
        }
      }

      // Persist final status
      await db.update(broadcasts)
        .set({
          sentCount,
          failedCount,
          status: sentCount === 0 ? 'failed' : failedCount === 0 ? 'completed' : 'completed',
          errorLog: errorLog.slice(0, 100),
          completedAt: new Date(),
        })
        .where(eq(broadcasts.id, broadcast.id));

      fastify.log.info({ broadcastId: broadcast.id, sentCount, failedCount }, 'Broadcast completed');
    },
  );

  /**
   * GET /v1/broadcasts/:id
   * Get full status + error log of a specific broadcast.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/broadcasts/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const [row] = await db.select().from(broadcasts)
        .where(and(eq(broadcasts.id, id), eq(broadcasts.tenantId, tenantId)));

      if (!row) return reply.status(404).send({ error: 'Broadcast not found' });
      return reply.send(row);
    },
  );

  /**
   * GET /v1/broadcasts/meta-health
   * Verifies the Meta credentials are valid and the phone number is active.
   * Returns { ok, phoneNumber } or { ok: false, error }.
   */
  fastify.get(
    '/v1/broadcasts/meta-health',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      if (!config.META_ACCESS_TOKEN || !config.META_PHONE_NUMBER_ID) {
        return reply.send({ ok: false, error: 'META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not set' });
      }
      const meta = new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
      const result = await meta.testConnection();
      return reply.send(result);
    },
  );
};
