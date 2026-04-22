/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/paymentExpiry.processor.ts
 * Role    : Expires unpaid invoices after 24 hours. Releases stock reservation.
 *           Sends PAYMENT_EXPIRED WA template. Transitions conversation to PAYMENT_EXPIRED.
 *           Idempotent: already-paid orders are skipped silently.
 * Imports : @lynkbot/db, @lynkbot/wati
 * Exports : paymentExpiryProcessor
 * Job data: { orderId: string, tenantId: string, conversationId: string }
 */
import type { Processor } from 'bullmq';
import { db, orders, conversations, inventory, buyers, products, tenants, auditLogs } from '@lynkbot/db';
import { eq, and } from '@lynkbot/db';
import { pgClient } from '@lynkbot/db';
import { WatiClient } from '@lynkbot/wati';
import { createDecipheriv } from 'crypto';

function decryptApiKey(encrypted: string): string {
  const key = (process.env.JWT_SECRET ?? 'default_key_32_chars_minimum_!!').slice(0, 32);
  const [ivHex, encHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(encHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export const paymentExpiryProcessor: Processor = async (job) => {
  const { orderId, tenantId, conversationId } = job.data as {
    orderId: string;
    tenantId: string;
    conversationId: string;
  };

  // 1. Load order — skip if already paid (idempotent)
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) { job.log(`Order ${orderId} not found — skipping`); return; }
  if (order.status !== 'pending_payment') {
    job.log(`Order ${orderId} status is ${order.status} — already handled, skipping`);
    return;
  }

  // 2. Mark order as cancelled
  await db.update(orders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  // 3. Release stock reservation (raw SQL)
  await pgClient`
    UPDATE inventory
    SET quantity_available = quantity_available + 1,
        quantity_reserved = GREATEST(0, quantity_reserved - 1),
        updated_at = NOW()
    WHERE product_id = ${order.productId}
      AND tenant_id = ${tenantId}
  `;

  // 4. Transition conversation to PAYMENT_EXPIRED
  if (conversationId) {
    await db.update(conversations)
      .set({ state: 'PAYMENT_EXPIRED', lastMessageAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  // 5. Load tenant WATI client and send template
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, order.buyerId) });
  const product = await db.query.products.findFirst({ where: eq(products.id, order.productId) });

  if (tenant?.watiApiKeyEnc && buyer && product) {
    try {
      const apiKey = decryptApiKey(tenant.watiApiKeyEnc);
      const wati = new WatiClient(apiKey);
      await wati.sendTemplate({
        phone: buyer.waPhone,
        templateName: 'PAYMENT_EXPIRED',
        parameters: [buyer.displayName ?? 'Kak', product.name],
      });
    } catch (err) {
      job.log(`Failed to send PAYMENT_EXPIRED template: ${(err as Error).message}`);
    }
  }

  // 6. Audit log
  await db.insert(auditLogs).values({
    tenantId,
    resourceType: 'order',
    resourceId: orderId,
    action: 'payment_expired',
    actorType: 'system',
    metadata: { orderId, previousStatus: 'pending_payment', newStatus: 'cancelled' },
  });

  job.log(`✅ Payment expired for order ${orderId} — stock released, conversation updated`);
};
