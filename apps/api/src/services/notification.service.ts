/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/notification.service.ts
 * Role    : Outbound WA template dispatcher via Meta Cloud API.
 *           All proactive WA → template only (never freeform).
 *           Templates mapped to WABA-approved Zoko templates on account 538059646048440.
 * Template map (WABA-approved):
 *   shipping_confirmed → zoko_shopify__shipping_confirmation_002  (name, orderCode, trackingUrl)
 *   shipping_update    → zoko_shopify__shipping_update_002        (orderCode, trackingUrl)
 *   delivered          → zoko_order_confirm_and_feedback_image    (name)
 *   payment_reminder   → zoko_shopify__payment_reminder_002       (name, productName, callToAction)
 *   restock            → zoko_reorder_reminder_01                 (productName)
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

  private normalisePhone(phone: string): string {
    return phone.replace(/^\+/, '');
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
    buyerName: string,
  ): Promise<void> {
    const status = shipment.currentStatus;
    const trackingUrl = `https://www.cekresi.com/?noresi=${shipment.resiNumber}`;

    if (status === 'in_transit') {
      // "Hi {{1}}, Your order {{2}} has been shipped. Track the progress at {{3}}"
      await this.client.sendTemplate({
        to: this.normalisePhone(buyerPhone),
        templateName: 'zoko_shopify__shipping_confirmation_002',
        languageCode: 'en',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: buyerName },
            { type: 'text', text: shipment.orderCode },
            { type: 'text', text: trackingUrl },
          ],
        }],
      });
    } else if (status === 'out_for_delivery' || status === 'exception') {
      // "*Delivery Update* There is a shipping update for your order {{1}}. Track at {{2}}"
      await this.client.sendTemplate({
        to: this.normalisePhone(buyerPhone),
        templateName: 'zoko_shopify__shipping_update_002',
        languageCode: 'en',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: shipment.orderCode },
            { type: 'text', text: trackingUrl },
          ],
        }],
      });
    } else if (status === 'delivered') {
      // "Hi {{1}}, Thank you for being a valuable customer. Would you consider giving us a review?"
      await this.client.sendTemplate({
        to: this.normalisePhone(buyerPhone),
        templateName: 'zoko_order_confirm_and_feedback_image',
        languageCode: 'en',
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: buyerName }],
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

    // "Hi {{1}}, Payment for your order from {{2}} is still pending.
    //  Click on the link to complete the payment and confirm your order. {{3}}"
    // Re-purposed as payment-expired nudge — buyer can reply to restart.
    await this.client.sendTemplate({
      to: this.normalisePhone(buyer.waPhone),
      templateName: 'zoko_shopify__payment_reminder_002',
      languageCode: 'en',
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: buyer.displayName ?? 'Kak' },
          { type: 'text', text: product.name },
          { type: 'text', text: 'Reply to this message to place a new order 😊' },
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
        // "We were told that you ordered {{1}} some time back.
        //  Hope you are enjoying it, but we'd hate for you to run out."
        await this.client.sendTemplate({
          to: this.normalisePhone(entry.waPhone),
          templateName: 'zoko_reorder_reminder_01',
          languageCode: 'en',
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
