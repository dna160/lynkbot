/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/broadcasts.ts
 * Role    : Broadcast management — list templates, create broadcast, send to buyer list.
 *           Broadcasts use WATI sendTemplate() only (compliance: never freeform outbound).
 * Exports : broadcastRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from '@lynkbot/db';
import { db, buyers, broadcasts } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { config } from '../../config';

export const broadcastRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/broadcasts/templates
   * Returns the list of registered Meta-approved templates.
   * Templates must be pre-approved in Meta Business Manager.
   */
  fastify.get(
    '/v1/broadcasts/templates',
    { preHandler: fastify.authenticate },
    async (_request, reply) => {
      // Meta templates are managed in Meta Business Manager.
      // Return a static list of known approved templates for this account.
      const templates = [
        { key: 'order_confirmation', name: 'order_confirmation', languageCode: 'id', params: ['buyer_name', 'order_id', 'total'] },
        { key: 'payment_reminder', name: 'payment_reminder', languageCode: 'id', params: ['buyer_name', 'amount', 'deadline'] },
        { key: 'shipping_update', name: 'shipping_update', languageCode: 'id', params: ['buyer_name', 'courier', 'tracking_number'] },
        { key: 'restock_alert', name: 'restock_alert', languageCode: 'id', params: ['product_name'] },
      ];
      return reply.send({ templates });
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
   * Create and immediately send a broadcast using a WATI template.
   * Body: { templateKey, parameters: string[], audienceFilter?: { tags?: string[] } }
   *
   * Sends to all buyers for this tenant (or filtered by tag).
   * Uses WATI sendTemplate() — compliant for outbound outside 24hr window.
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

      const knownTemplates: Record<string, { name: string; languageCode: string }> = {
        order_confirmation: { name: 'order_confirmation', languageCode: 'id' },
        payment_reminder: { name: 'payment_reminder', languageCode: 'id' },
        shipping_update: { name: 'shipping_update', languageCode: 'id' },
        restock_alert: { name: 'restock_alert', languageCode: 'id' },
      };
      const template = knownTemplates[templateKey];
      if (!template) {
        return reply.status(400).send({ error: `Unknown template: ${templateKey}` });
      }

      // Fetch audience
      let audience = await db.select({ id: buyers.id, waPhone: buyers.waPhone })
        .from(buyers)
        .where(and(
          eq(buyers.tenantId, tenantId),
          eq(buyers.doNotContact, false),
        ));

      // Filter by tags if provided
      if (audienceFilter?.tags?.length) {
        audience = audience.filter((b: any) => {
          // tags stored as jsonb array in DB — already parsed
          const buyerTags: string[] = (b as any).tags ?? [];
          return audienceFilter.tags!.some((t) => buyerTags.includes(t));
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

      // Fire and forget — respond immediately, send in background
      reply.send({
        id: broadcast.id,
        recipientCount: audience.length,
        status: 'sending',
        message: `Sending to ${audience.length} contacts`,
      });

      // Background send via Meta
      const meta = new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
      let sentCount = 0;
      let failedCount = 0;
      const errorLog: string[] = [];

      // Build template components from positional parameters
      const components = parameters.length > 0
        ? [{ type: 'body', parameters: parameters.map((p) => ({ type: 'text', text: p })) }]
        : [];

      for (const recipient of audience) {
        try {
          await meta.sendTemplate({
            to: recipient.waPhone,
            templateName: template.name,
            languageCode: template.languageCode,
            components,
          });
          sentCount++;
        } catch (err: any) {
          failedCount++;
          errorLog.push(`${recipient.waPhone}: ${err?.message ?? 'unknown'}`);
        }
      }

      // Update broadcast record
      await db.update(broadcasts)
        .set({
          sentCount,
          failedCount,
          status: failedCount === audience.length ? 'failed' : 'completed',
          errorLog: errorLog.slice(0, 50),
          completedAt: new Date(),
        })
        .where(eq(broadcasts.id, broadcast.id));
    },
  );

  /**
   * GET /v1/broadcasts/:id
   * Get status of a specific broadcast.
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
};
