/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/orders.ts
 * Role    : Order management routes including resi entry and CSV export.
 *           All routes require JWT auth.
 * Exports : orderRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from '@lynkbot/db';
import { Queue } from 'bullmq';
import { db, orders, shipments, conversations } from '@lynkbot/db';
import { QUEUES } from '@lynkbot/shared';
import { config } from '../../config';

const trackingQueue = new Queue(QUEUES.TRACKING, { connection: { url: config.REDIS_URL } });

const resiSchema = z.object({
  resiNumber: z.string().min(1).max(100),
  courierCode: z.string().min(1).max(50),
});

const COURIER_NAMES: Record<string, string> = {
  jne: 'JNE',
  jnt: 'J&T Express',
  sicepat: 'SiCepat',
  pos: 'Pos Indonesia',
  anteraja: 'Anteraja',
  tiki: 'TIKI',
  gosend: 'GoSend',
  grab: 'GrabExpress',
};

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const str = v == null ? '' : String(v);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ];
  return lines.join('\n');
}

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/orders
   * List orders with optional status filter, pagination.
   */
  fastify.get<{ Querystring: { status?: string; page?: string; limit?: string } }>(
    '/v1/orders',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      let query = db.select().from(orders).where(eq(orders.tenantId, tenantId));

      // NOTE: Drizzle doesn't easily chain optional where — use a raw where clause approach
      const statusFilter = request.query.status;
      const validStatuses = ['pending_payment', 'payment_confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

      let rows;
      if (statusFilter && validStatuses.includes(statusFilter)) {
        rows = await db.select().from(orders)
          .where(and(eq(orders.tenantId, tenantId), eq(orders.status, statusFilter as any)))
          .orderBy(desc(orders.createdAt))
          .limit(limit)
          .offset(offset);
      } else {
        rows = await db.select().from(orders)
          .where(eq(orders.tenantId, tenantId))
          .orderBy(desc(orders.createdAt))
          .limit(limit)
          .offset(offset);
      }

      return reply.send({ items: rows, total: rows.length, page, limit });
    },
  );

  /**
   * GET /v1/orders/export.csv
   * Export orders as CSV download.
   * NOTE: Must be registered before /v1/orders/:id to avoid route conflict.
   */
  fastify.get(
    '/v1/orders/export.csv',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;

      const rows = await db.select({
        orderCode: orders.orderCode,
        buyerId: orders.buyerId,
        productId: orders.productId,
        quantity: orders.quantity,
        unitPriceIdr: orders.unitPriceIdr,
        shippingCostIdr: orders.shippingCostIdr,
        totalAmountIdr: orders.totalAmountIdr,
        status: orders.status,
        courierCode: orders.courierCode,
        courierService: orders.courierService,
        paymentMethod: orders.paymentMethod,
        paidAt: orders.paidAt,
        createdAt: orders.createdAt,
      }).from(orders)
        .where(eq(orders.tenantId, tenantId))
        .orderBy(desc(orders.createdAt));

      const csvRows = rows.map(r => ({
        ...r,
        paidAt: r.paidAt?.toISOString() ?? '',
        createdAt: r.createdAt.toISOString(),
      }));

      const csv = toCsv(csvRows as Record<string, unknown>[]);
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="orders-${tenantId}-${Date.now()}.csv"`);
      return reply.send(csv);
    },
  );

  /**
   * GET /v1/orders/:id
   * Get a single order with its shipment.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/orders/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, id), eq(orders.tenantId, tenantId)),
      });
      if (!order) return reply.status(404).send({ error: 'Order not found' });

      const shipment = await db.query.shipments.findFirst({
        where: and(eq(shipments.orderId, id), eq(shipments.tenantId, tenantId)),
      });

      return reply.send({ ...order, shipment: shipment ?? null });
    },
  );

  /**
   * POST /v1/orders/:id/resi
   * Enter tracking number. Creates shipment record and enqueues tracking job.
   * Transitions conversation to SHIPPED state.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/orders/:id/resi',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const parsed = resiSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      }

      const { resiNumber, courierCode } = parsed.data;

      const order = await db.query.orders.findFirst({
        where: and(eq(orders.id, id), eq(orders.tenantId, tenantId)),
      });
      if (!order) return reply.status(404).send({ error: 'Order not found' });

      if (!['payment_confirmed', 'processing'].includes(order.status)) {
        return reply.status(422).send({ error: `Cannot add resi for order with status: ${order.status}` });
      }

      // Create or update shipment record
      const courierName = COURIER_NAMES[courierCode.toLowerCase()] ?? courierCode.toUpperCase();

      const [shipment] = await db.insert(shipments).values({
        orderId: id,
        tenantId,
        resiNumber,
        courierCode: courierCode.toLowerCase(),
        courierName,
        currentStatus: 'in_transit',
        trackingHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing().returning();

      // Update order status to shipped
      await db.update(orders)
        .set({ status: 'shipped', updatedAt: new Date() })
        .where(eq(orders.id, id));

      // Transition conversation to SHIPPED
      if (order.conversationId) {
        await db.update(conversations)
          .set({ state: 'SHIPPED', lastMessageAt: new Date() })
          .where(eq(conversations.id, order.conversationId));
      }

      // Enqueue tracking job
      await trackingQueue.add('track-shipment', {
        shipmentId: shipment?.id ?? id,
        orderId: id,
        tenantId,
        resiNumber,
        courierCode: courierCode.toLowerCase(),
      }, {
        jobId: `track:${id}`,
        repeat: { every: 4 * 60 * 60 * 1000 }, // every 4 hours
      });

      return reply.status(201).send({
        shipmentId: shipment?.id,
        orderId: id,
        resiNumber,
        courierCode,
        courierName,
        status: 'in_transit',
      });
    },
  );
};
