/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/conversations.ts
 * Role    : Conversation list, detail, takeover, return-to-bot, and send-message routes.
 *           All routes require JWT auth.
 * Exports : conversationRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from '@lynkbot/db';
import { db, conversations, messages, buyers } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { config } from '../../config';

function isWithin24HourWindow(lastMessageAt: Date | string): boolean {
  return Date.now() - new Date(lastMessageAt).getTime() < 24 * 60 * 60 * 1000;
}

export const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/conversations
   * List conversations with optional state/isActive filters.
   * Joins buyer info so the dashboard can show phone + name.
   */
  fastify.get<{ Querystring: { state?: string; isActive?: string; page?: string; limit?: string } }>(
    '/v1/conversations',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      const isActive = request.query.isActive === 'false' ? false
        : request.query.isActive === 'true' ? true
        : undefined;

      const stateFilter = request.query.state;

      let conditions: any[] = [eq(conversations.tenantId, tenantId)];
      if (isActive !== undefined) conditions.push(eq(conversations.isActive, isActive));
      if (stateFilter) conditions.push(eq(conversations.state, stateFilter as any));

      const rows = await db
        .select({
          id: conversations.id,
          tenantId: conversations.tenantId,
          buyerId: conversations.buyerId,
          productId: conversations.productId,
          state: conversations.state,
          isActive: conversations.isActive,
          messageCount: conversations.messageCount,
          lastMessageAt: conversations.lastMessageAt,
          startedAt: conversations.startedAt,
          buyerWaPhone: buyers.waPhone,
          buyerDisplayName: buyers.displayName,
        })
        .from(conversations)
        .leftJoin(buyers, eq(buyers.id, conversations.buyerId))
        .where(and(...conditions))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(limit)
        .offset(offset);

      const items = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        buyerId: r.buyerId,
        productId: r.productId,
        state: r.state,
        isActive: r.isActive,
        messageCount: r.messageCount,
        lastMessageAt: r.lastMessageAt,
        startedAt: r.startedAt,
        isHumanTakeover: r.state === 'ESCALATED',
        buyer: { waPhone: r.buyerWaPhone ?? '', displayName: r.buyerDisplayName ?? undefined },
      }));

      return reply.send({ items, total: items.length, page, limit });
    },
  );

  /**
   * GET /v1/conversations/:id
   * Get a conversation with its messages and buyer info.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/conversations/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const row = await db
        .select({
          id: conversations.id,
          tenantId: conversations.tenantId,
          buyerId: conversations.buyerId,
          productId: conversations.productId,
          state: conversations.state,
          isActive: conversations.isActive,
          messageCount: conversations.messageCount,
          lastMessageAt: conversations.lastMessageAt,
          startedAt: conversations.startedAt,
          buyerWaPhone: buyers.waPhone,
          buyerDisplayName: buyers.displayName,
        })
        .from(conversations)
        .leftJoin(buyers, eq(buyers.id, conversations.buyerId))
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
        .limit(1);

      if (!row.length) return reply.status(404).send({ error: 'Conversation not found' });
      const conv = row[0];

      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(messages.createdAt);

      return reply.send({
        id: conv.id,
        tenantId: conv.tenantId,
        buyerId: conv.buyerId,
        productId: conv.productId,
        state: conv.state,
        isActive: conv.isActive,
        messageCount: conv.messageCount,
        lastMessageAt: conv.lastMessageAt,
        startedAt: conv.startedAt,
        isHumanTakeover: conv.state === 'ESCALATED',
        buyer: { waPhone: conv.buyerWaPhone ?? '', displayName: conv.buyerDisplayName ?? undefined },
        messages: msgs,
      });
    },
  );

  /**
   * POST /v1/conversations/:id/send-message
   * Send a freeform message from the dashboard agent to the buyer via WATI.
   * Requires conversation to be ESCALATED (human takeover mode).
   * Enforces the 24hr WhatsApp session window.
   */
  fastify.post<{ Params: { id: string }; Body: { text: string } }>(
    '/v1/conversations/:id/send-message',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { text } = request.body ?? {};

      if (!text?.trim()) {
        return reply.status(400).send({ error: 'text is required' });
      }

      const row = await db
        .select({
          id: conversations.id,
          state: conversations.state,
          lastMessageAt: conversations.lastMessageAt,
          messageCount: conversations.messageCount,
          buyerWaPhone: buyers.waPhone,
        })
        .from(conversations)
        .leftJoin(buyers, eq(buyers.id, conversations.buyerId))
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)))
        .limit(1);

      if (!row.length) return reply.status(404).send({ error: 'Conversation not found' });
      const conv = row[0];

      if (conv.state !== 'ESCALATED') {
        return reply.status(422).send({
          error: 'Can only send messages to escalated conversations. Use "Take Over" first.',
        });
      }

      const within24hr = isWithin24HourWindow(conv.lastMessageAt);
      if (!within24hr) {
        return reply.status(422).send({
          error: 'WhatsApp 24-hour session has expired. Cannot send freeform messages. Use a template.',
        });
      }

      // Send via Meta — in dev mode we tolerate errors (test phone numbers)
      const meta = new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
      try {
        await meta.sendText({
          to: conv.buyerWaPhone!,
          message: text.trim(),
          isWithin24hrWindow: true,
        });
      } catch (sendErr: any) {
        if (config.NODE_ENV === 'production') {
          const errMsg = sendErr?.response?.data?.error?.message ?? sendErr?.message ?? 'Meta send error';
          return reply.status(502).send({ error: `Failed to send via WhatsApp: ${errMsg}` });
        }
        // In dev: log and continue — still persist to DB for UI testing
        request.log.warn({ err: sendErr }, 'Meta send failed (dev mode — message saved to DB anyway)');
      }

      // Persist the outbound message
      const [saved] = await db
        .insert(messages)
        .values({
          conversationId: id,
          tenantId,
          direction: 'outbound',
          messageType: 'text',
          textContent: text.trim(),
        })
        .returning();

      // Update conversation lastMessageAt + messageCount
      await db
        .update(conversations)
        .set({
          lastMessageAt: new Date(),
          messageCount: (conv.messageCount ?? 0) + 1,
        })
        .where(eq(conversations.id, id));

      return reply.send(saved);
    },
  );

  /**
   * POST /v1/conversations/:id/takeover
   * Set state to ESCALATED (human takes over).
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/conversations/:id/takeover',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const conv = await db.query.conversations.findFirst({
        where: and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
      });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      if (conv.state === 'ESCALATED') {
        return reply.send({ id, state: 'ESCALATED', message: 'Already escalated' });
      }

      const [updated] = await db.update(conversations)
        .set({ state: 'ESCALATED', lastMessageAt: new Date() })
        .where(eq(conversations.id, id))
        .returning();

      return reply.send({ id, previousState: conv.state, state: updated.state });
    },
  );

  /**
   * POST /v1/conversations/:id/return-to-bot
   * Return conversation to AI control.
   */
  fastify.post<{ Params: { id: string }; Body: { targetState?: string } }>(
    '/v1/conversations/:id/return-to-bot',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const conv = await db.query.conversations.findFirst({
        where: and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)),
      });
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' });

      if (conv.state !== 'ESCALATED') {
        return reply.status(422).send({ error: 'Conversation is not currently escalated' });
      }

      const restoreState = (request.body as any)?.targetState ?? 'BROWSING';
      const validStates = [
        'BROWSING', 'PRODUCT_INQUIRY', 'OBJECTION_HANDLING',
        'CHECKOUT_INTENT', 'ADDRESS_COLLECTION', 'AWAITING_PAYMENT',
      ];
      const targetState = validStates.includes(restoreState) ? restoreState : 'BROWSING';

      const [updated] = await db.update(conversations)
        .set({ state: targetState as any, lastMessageAt: new Date() })
        .where(eq(conversations.id, id))
        .returning();

      return reply.send({ id, previousState: 'ESCALATED', state: updated.state });
    },
  );
};
