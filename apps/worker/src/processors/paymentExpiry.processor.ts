/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/paymentExpiry.processor.ts
 * Role    : Expires unpaid invoices after 24 hours. Releases stock reservation.
 *           Sends payment_expired WA template via Meta Cloud API.
 *           Transitions conversation to PAYMENT_EXPIRED.
 *           Idempotent: already-paid orders are skipped silently.
 * Imports : @lynkbot/db, @lynkbot/meta
 * Exports : paymentExpiryProcessor
 * Job data: { orderId: string, tenantId: string, conversationId: string }
 */
import type { Processor } from 'bullmq';
import { db, orders, conversations, buyers, products, auditLogs } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { pgClient } from '@lynkbot/db';
import { getTenantMetaClient } from '../_meta.helper';

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

  // 3. Release stock reservation (raw SQL — atomic)
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

  // 5. Send PAYMENT_EXPIRED template via Meta
  const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, order.buyerId) });
  const product = await db.query.products.findFirst({ where: eq(products.id, order.productId) });

  if (buyer && product) {
    try {
      const meta = await getTenantMetaClient(tenantId);
      // zoko_shopify__payment_reminder_002:
      // "Hi {{1}}, Payment for your order from {{2}} is still pending.
      //  Click on the link to complete the payment and confirm your order. {{3}}"
      // We re-purpose it as a payment-expired nudge: buyer can reply to restart.
      await meta.sendTemplate({
        to: buyer.waPhone.replace(/^\+/, ''),
        templateName: 'zoko_shopify__payment_reminder_002',
        languageCode: 'en',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: buyer.displayName ?? 'Kak' },
              { type: 'text', text: product.name },
              { type: 'text', text: 'Reply to this message to place a new order 😊' },
            ],
          },
        ],
      });
    } catch (err) {
      job.log(`Failed to send payment reminder template: ${(err as Error).message}`);
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
