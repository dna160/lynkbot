/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/notification.service.ts
 * Role    : Outbound WA template dispatcher via Meta Cloud API.
 *           All proactive WA → template only (never freeform).
 *           All tenants share the system-level Meta access token.
 * Exports : NotificationService class
 * DO NOT  : Import from @lynkbot/wati — use @lynkbot/meta
 */
import { db, buyers, products, waitlist } from '@lynkbot/db';
import { eq, and } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { config } from '../config';

export class NotificationService {
  private client: MetaClient;

  constructor() {
    this.client = new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
  }

  async sendTrackingUpdate(
    _tenantId: string,
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
    _lynkerSocialHandle?: string,
  ): Promise<void> {
    const status = shipment.currentStatus;

    if (status === 'in_transit') {
      const trackingUrl = `https://www.cekresi.com/?noresi=${shipment.resiNumber}`;
      const etaDisplay = shipment.estimatedDelivery
        ? shipment.estimatedDelivery.toLocaleDateString('id-ID')
        : 'Estimasi 2-3 hari';

      await this.client.sendTemplate({
        to: buyerPhone,
        templateName: 'order_shipped',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: shipment.courierName },
            { type: 'text', text: shipment.resiNumber },
            { type: 'text', text: trackingUrl },
            { type: 'text', text: etaDisplay },
          ],
        }],
      });
    } else if (status === 'out_for_delivery') {
      await this.client.sendTemplate({
        to: buyerPhone,
        templateName: 'out_for_delivery',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: productName }],
        }],
      });
    } else if (status === 'delivered') {
      await this.client.sendTemplate({
        to: buyerPhone,
        templateName: 'delivered',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: productName }],
        }],
      });
    } else if (status === 'exception') {
      await this.client.sendTemplate({
        to: buyerPhone,
        templateName: 'shipping_exception',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: shipment.orderCode },
            { type: 'text', text: shipment.courierName },
            { type: 'text', text: shipment.resiNumber },
          ],
        }],
      });
    }
  }

  async sendPaymentExpired(
    _tenantId: string,
    order: { id: string; buyerId: string; productId: string },
  ): Promise<void> {
    const buyer = await db.query.buyers.findFirst({
      where: eq(buyers.id, order.buyerId),
    });
    const product = await db.query.products.findFirst({
      where: eq(products.id, order.productId),
    });

    if (!buyer || !product) return;

    await this.client.sendTemplate({
      to: buyer.waPhone,
      templateName: 'payment_expired',
      languageCode: 'id',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: buyer.displayName ?? buyer.waPhone },
          { type: 'text', text: product.name },
        ],
      }],
    });
  }

  async sendRestockNotifications(_tenantId: string, productId: string): Promise<void> {
    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
    });
    if (!product) return;

    const entries = await db.query.waitlist.findMany({
      where: and(
        eq(waitlist.productId, productId),
        eq(waitlist.isNotified, false),
      ),
    });

    for (const entry of entries) {
      try {
        await this.client.sendTemplate({
          to: entry.waPhone,
          templateName: 'restock_alert',
          languageCode: 'id',
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: product.name }],
          }],
        });

        await db
          .update(waitlist)
          .set({ isNotified: true, notifiedAt: new Date() })
          .where(eq(waitlist.id, entry.id));
      } catch (err) {
        console.error(`Failed to send restock notification to ${entry.waPhone}:`, err);
      }
    }
  }
}
