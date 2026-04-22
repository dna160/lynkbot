/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/inventory.ts
 * Role    : Inventory read and stock-level update routes.
 *           All routes require JWT auth.
 * Exports : inventoryRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and } from '@lynkbot/db';
import { db, inventory } from '@lynkbot/db';

const updateInventorySchema = z.object({
  quantityAvailable: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
});

export const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/inventory
   * List inventory records for all tenant products.
   */
  fastify.get(
    '/v1/inventory',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const rows = await db.select().from(inventory).where(eq(inventory.tenantId, tenantId));
      return reply.send(rows);
    },
  );

  /**
   * GET /v1/inventory/:productId
   * Get inventory for a single product.
   */
  fastify.get<{ Params: { productId: string } }>(
    '/v1/inventory/:productId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { productId } = request.params;

      const row = await db.query.inventory.findFirst({
        where: and(eq(inventory.productId, productId), eq(inventory.tenantId, tenantId)),
      });

      if (!row) return reply.status(404).send({ error: 'Inventory record not found' });
      return reply.send(row);
    },
  );

  /**
   * PATCH /v1/inventory/:productId
   * Update quantityAvailable and/or lowStockThreshold.
   * quantityReserved and quantitySold are managed by the system — not settable here.
   */
  fastify.patch<{ Params: { productId: string } }>(
    '/v1/inventory/:productId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { productId } = request.params;

      const parsed = updateInventorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      }

      if (!parsed.data.quantityAvailable && !parsed.data.lowStockThreshold) {
        return reply.status(400).send({ error: 'Provide quantityAvailable and/or lowStockThreshold' });
      }

      const [updated] = await db.update(inventory)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(inventory.productId, productId), eq(inventory.tenantId, tenantId)))
        .returning();

      if (!updated) return reply.status(404).send({ error: 'Inventory record not found' });
      return reply.send(updated);
    },
  );
};
