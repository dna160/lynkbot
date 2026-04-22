/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/restock.processor.ts
 * Role    : Notifies waitlisted buyers when a product is back in stock.
 *           Sends RESTOCK_NOTIFY WA template. Marks waitlist entries as notified.
 *           Rate limited: max 50 per run. Re-enqueues remainder if more than 50.
 * Imports : @lynkbot/db, @lynkbot/wati
 * Exports : restockProcessor
 * Job data: { productId: string, tenantId: string }
 */
import type { Processor } from 'bullmq';
import { db, waitlist, buyers, products, tenants } from '@lynkbot/db';
import { eq, and, isNull } from '@lynkbot/db';
import { WatiClient } from '@lynkbot/wati';
import { createDecipheriv } from 'crypto';
import { getQueue } from '../queues';
import { QUEUES } from '@lynkbot/shared';

const BATCH_SIZE = 50;

function decryptApiKey(encrypted: string): string {
  const key = (process.env.JWT_SECRET ?? 'default_key_32_chars_minimum_!!').slice(0, 32);
  const [ivHex, encHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(encHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

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

  // Load tenant and product
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });

  if (!tenant?.watiApiKeyEnc || !product) {
    job.log('Missing tenant WATI key or product — aborting');
    return;
  }

  const apiKey = decryptApiKey(tenant.watiApiKeyEnc);
  const wati = new WatiClient(apiKey);

  let notified = 0;
  for (const entry of batch) {
    if (!entry.buyerId) continue;
    const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, entry.buyerId) });
    if (!buyer) continue;

    try {
      await wati.sendTemplate({
        phone: buyer.waPhone,
        templateName: 'RESTOCK_NOTIFY',
        parameters: [product.name],
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
