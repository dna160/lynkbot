/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/inventory.service.ts
 * Role    : Stock management with atomic raw SQL FOR UPDATE locks.
 *           CRITICAL: reserveStock() uses raw SQL, not Drizzle ORM.
 *           This is the guard against inventory oversell in concurrent checkouts.
 * Exports : InventoryService class
 * DO NOT  : Replace reserveStock() raw SQL with Drizzle ORM.
 */
import { pgClient, db, inventory } from '@lynkbot/db';
import { eq, and, sql } from '@lynkbot/db';

export class InventoryService {
  async checkStock(productId: string): Promise<number> {
    const inv = await db.query.inventory.findFirst({
      where: eq(inventory.productId, productId),
    });
    return inv?.quantityAvailable ?? 0;
  }

  async reserveStock(productId: string, tenantId: string, quantity = 1): Promise<boolean> {
    // CRITICAL: Raw SQL with FOR UPDATE — prevents oversell under concurrent checkouts
    const result = await pgClient.begin(async (sql) => {
      const rows = await sql`
        SELECT id, quantity_available
        FROM inventory
        WHERE product_id = ${productId}
          AND tenant_id = ${tenantId}
        FOR UPDATE
      `;
      if (!rows[0] || rows[0].quantity_available < quantity) return false;
      await sql`
        UPDATE inventory
        SET quantity_available = quantity_available - ${quantity},
            quantity_reserved  = quantity_reserved  + ${quantity},
            updated_at = NOW()
        WHERE id = ${rows[0].id}
      `;
      return true;
    });
    return result as boolean;
  }

  async releaseReservation(productId: string, tenantId: string, quantity = 1): Promise<void> {
    await pgClient`
      UPDATE inventory
      SET quantity_available = quantity_available + ${quantity},
          quantity_reserved  = GREATEST(0, quantity_reserved - ${quantity}),
          updated_at = NOW()
      WHERE product_id = ${productId} AND tenant_id = ${tenantId}
    `;
  }

  async confirmSale(productId: string, tenantId: string, quantity = 1): Promise<void> {
    await pgClient`
      UPDATE inventory
      SET quantity_reserved = GREATEST(0, quantity_reserved - ${quantity}),
          quantity_sold = quantity_sold + ${quantity},
          updated_at = NOW()
      WHERE product_id = ${productId} AND tenant_id = ${tenantId}
    `;
  }

  async addStock(productId: string, tenantId: string, quantity: number): Promise<void> {
    await db
      .update(inventory)
      .set({
        quantityAvailable: sql`${inventory.quantityAvailable} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(and(eq(inventory.productId, productId), eq(inventory.tenantId, tenantId)));
  }
}
