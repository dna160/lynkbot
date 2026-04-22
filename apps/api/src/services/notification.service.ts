/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/notification.service.ts
 * Role    : Outbound WA template dispatcher. All proactive WA → template only (never freeform).
 *           Caches WatiClient instances per tenantId (decrypts API key once).
 * Exports : NotificationService class
 */
import { db, tenants, buyers, products, waitlist } from '@lynkbot/db';
import { eq, isNull, and } from '@lynkbot/db';
import { WatiClient } from '@lynkbot/wati';
import { createDecipheriv } from 'crypto';
import { config } from '../config';

export class NotificationService {
  private clientCache = new Map<string, WatiClient>();

  async getWatiClientForTenant(tenantId: string): Promise<WatiClient> {
    const cached = this.clientCache.get(tenantId);
    if (cached) return cached;

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant || !tenant.watiApiKeyEnc) {
      throw new Error(`Tenant ${tenantId} has no WATI API key configured`);
    }

    const apiKey = this.decryptApiKey(tenant.watiApiKeyEnc);
    const client = new WatiClient(apiKey, config.WATI_BASE_URL);
    this.clientCache.set(tenantId, client);
    return client;
  }

  private decryptApiKey(encryptedKey: string): string {
    // AES-256-CBC decryption using JWT_SECRET first 32 chars as key
    // If key was stored plaintext (pre-encryption era), return as-is
    try {
      const keyBuffer = Buffer.from(config.JWT_SECRET.slice(0, 32), 'utf8');
      // Format: iv_hex:encrypted_hex
      const colonIdx = encryptedKey.indexOf(':');
      if (colonIdx === -1) {
        // Stored as plaintext (manual ops path) — return directly
        return encryptedKey;
      }
      const iv = Buffer.from(encryptedKey.slice(0, colonIdx), 'hex');
      const encrypted = Buffer.from(encryptedKey.slice(colonIdx + 1), 'hex');
      const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      // Fallback: treat as plaintext (backwards compat)
      return encryptedKey;
    }
  }

  async sendTrackingUpdate(
    tenantId: string,
    shipment: {
      orderId: string;
      orderCode: string;
      resiNumber: string;
      courierName: string;
      courierCode: string;
      currentStatus: string;
      estimatedDelivery?: Date | null;
    },
    buyerPhone: string,
    productName: string,
    lynkerSocialHandle?: string,
  ): Promise<void> {
    const client = await this.getWatiClientForTenant(tenantId);
    const status = shipment.currentStatus;

    if (status === 'in_transit') {
      const trackingUrl = `https://www.cekresi.com/?noresi=${shipment.resiNumber}`;
      const etaDisplay = shipment.estimatedDelivery
        ? shipment.estimatedDelivery.toLocaleDateString('id-ID')
        : 'Estimasi 2-3 hari';

      await client.sendTemplate({
        phone: buyerPhone,
        templateName: 'ORDER_SHIPPED',
        parameters: [
          shipment.courierName,
          shipment.resiNumber,
          trackingUrl,
          etaDisplay,
        ],
      });
    } else if (status === 'out_for_delivery') {
      await client.sendTemplate({
        phone: buyerPhone,
        templateName: 'OUT_FOR_DELIVERY',
        parameters: [productName],
      });
    } else if (status === 'delivered') {
      await client.sendTemplate({
        phone: buyerPhone,
        templateName: 'DELIVERED',
        parameters: [productName, lynkerSocialHandle ?? ''],
      });
    } else if (status === 'exception') {
      await client.sendTemplate({
        phone: buyerPhone,
        templateName: 'SHIPPING_EXCEPTION',
        parameters: [
          shipment.orderCode,
          'Kendala pengiriman',
          shipment.courierName,
          shipment.resiNumber,
        ],
      });
    }
  }

  async sendPaymentExpired(
    tenantId: string,
    order: { id: string; buyerId: string; productId: string },
  ): Promise<void> {
    const client = await this.getWatiClientForTenant(tenantId);

    const buyer = await db.query.buyers.findFirst({
      where: eq(buyers.id, order.buyerId),
    });
    const product = await db.query.products.findFirst({
      where: eq(products.id, order.productId),
    });

    if (!buyer || !product) return;

    await client.sendTemplate({
      phone: buyer.waPhone,
      templateName: 'PAYMENT_EXPIRED',
      parameters: [buyer.displayName ?? buyer.waPhone, product.name],
    });
  }

  async sendRestockNotifications(tenantId: string, productId: string): Promise<void> {
    const client = await this.getWatiClientForTenant(tenantId);

    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
    });
    if (!product) return;

    const entries = await db.query.waitlist.findMany({
      where: and(
        eq(waitlist.productId, productId),
        eq(waitlist.tenantId, tenantId),
        eq(waitlist.isNotified, false),
      ),
    });

    for (const entry of entries) {
      try {
        await client.sendTemplate({
          phone: entry.waPhone,
          templateName: 'RESTOCK_NOTIFY',
          parameters: [product.name],
        });

        await db
          .update(waitlist)
          .set({ isNotified: true, notifiedAt: new Date() })
          .where(eq(waitlist.id, entry.id));
      } catch (err) {
        // Log but continue notifying remaining entries
        console.error(`Failed to send restock notification to ${entry.waPhone}:`, err);
      }
    }
  }

  /** Invalidate the cached client for a tenant (e.g. after key rotation) */
  invalidateClient(tenantId: string): void {
    this.clientCache.delete(tenantId);
  }
}
