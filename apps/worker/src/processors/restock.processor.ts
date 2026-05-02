/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/restock.processor.ts
 * Role    : Notifies waitlisted buyers when a product is back in stock.
 *           Sends restock_notify WA template via Meta Cloud API.
 *           Rate limited: max 50 per run. Re-enqueues remainder if more than 50.
 * Imports : @lynkbot/db, @lynkbot/meta
 * Exports : restockProcessor
 * Job data: { productId: string, tenantId: string }
 */
import type { Processor } from 'bullmq';
import { db, waitlist, buyers, products } from '@lynkbot/db';
import { eq, and, isNull } from '@lynkbot/db';
import { getQueue } from '../queues';
import { getTenantMetaClient } from '../_meta.helper';
import { QUEUES } from '@lynkbot/shared';

const BATCH_SIZE = 50;

export const restockProcessor: Processor = async (job) => {
  const { productId, tenantId } = job.data as { productId: string; tenantId: string };

  // Load all un-notified waitlist entries
  const entries = await db.query.waitlist.findMany({
    where: and(
      eq(waitlist.productId, productId),
      eq(waitlist.tenantId, tenantId),
      isNull(waitlist.notifiedAt),
    ),
    limit: BATCH_SIZE + 1,
  });

  const hasMore = entries.length > BATCH_SIZE;
  const batch = entries.slice(0, BATCH_SIZE);

  if (batch.length === 0) { job.log('No waitlist entries to notify'); return; }

  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  if (!product) {
    job.log('Product not found — aborting');
    return;
  }

  const meta = await getTenantMetaClient(tenantId);

  let notified = 0;
  for (const entry of batch) {
    if (!entry.buyerId) continue;
    const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, entry.buyerId) });
    if (!buyer) continue;

    try {
      // zoko_reorder_reminder_01:
      // "We were told that you ordered {{1}} some time back. Hope you are enjoying it,
      //  but we'd hate for you to run out. *Order Again* easily and stay awesome!!"
      await meta.sendTemplate({
        to: buyer.waPhone.replace(/^\+/, ''),
        templateName: 'zoko_reorder_reminder_01',
        languageCode: 'en',
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: product.name }],
          },
        ],
      });
      await db.update(waitlist)
        .set({ notifiedAt: new Date() })
        .where(eq(waitlist.id, entry.id));
      notified++;
    } catch (err) {
      job.log(`Failed to notify buyer ${buyer.waPhone}: ${(err as Error).message}`);
    }
  }

  // Re-enqueue if there are more
  if (hasMore) {
    await getQueue(QUEUES.RESTOCK_NOTIFY).add('restock', { productId, tenantId }, { delay: 2000 });
  }

  job.log(`✅ Notified ${notified}/${batch.length} waitlist entries for product ${productId}`);
};
