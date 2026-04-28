/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/payment.service.ts
 * Role    : Invoice creation and payment webhook processing.
 * Imports : @lynkbot/shared, @lynkbot/db, @lynkbot/payments, @lynkbot/meta
 * Exports : PaymentService class
 */
import { Queue } from 'bullmq';
import { db, conversations, orders, buyers, products } from '@lynkbot/db';
import { eq, and } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';
import { MidtransProvider, XenditProvider } from '@lynkbot/payments';
import { QUEUES } from '@lynkbot/shared';
import { config, getRedisConnection } from '../config';
import { InventoryService } from './inventory.service';
import type { IPaymentProvider } from '@lynkbot/payments';

type ConvRow = typeof conversations.$inferSelect;
type BuyerRow = { id: string; tenantId: string; waPhone: string; displayName: string | null };
type ProductRow = typeof products.$inferSelect;

interface SelectedCourier {
  code: string;
  service: string;
  cost: number;
  etaDays: number;
  name: string;
}

// Audit log helper — writes to stdout as structured JSON; replace with DB table as needed
import pino from 'pino';

const auditLogger = pino({ level: 'info' });

function auditLog(event: string, data: Record<string, unknown>): void {
  auditLogger.info({ event, ...data }, 'payment-audit');
}

export class PaymentService {
  private inventoryService = new InventoryService();
  private paymentExpiryQueue: Queue;

  constructor() {
    this.paymentExpiryQueue = new Queue(QUEUES.PAYMENT_EXPIRY, {
      connection: getRedisConnection(),
    });
  }

  private getPaymentProvider(): IPaymentProvider {
    if (config.PAYMENT_PROVIDER === 'midtrans') {
      if (!config.MIDTRANS_SERVER_KEY) throw new Error('MIDTRANS_SERVER_KEY not configured');
      return new MidtransProvider();
    }
    // Xendit path — dynamic import to avoid requiring both SDKs
    return new XenditProvider();
  }

  private getMetaClient(): MetaClient {
    return new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
  }

  async createInvoice(
    conv: ConvRow,
    buyer: BuyerRow,
    product: ProductRow,
    courier: SelectedCourier,
  ): Promise<void> {
    const orderCode = 'LB-' + Date.now().toString(36).toUpperCase();
    const unitPrice = product.priceIdr;
    const shippingCost = courier.cost;
    const totalAmount = unitPrice + shippingCost;

    // Determine payment method — default to va_bca; Lynkers can extend this
    const paymentMethod: 'va_bca' | 'va_mandiri' | 'va_bni' | 'va_bri' | 'qris' = 'va_bca';

    // Build shipping address from conversation draft
    const draft = conv.addressDraft as Record<string, unknown> | null;
    if (!draft) throw new Error('No address draft found on conversation');

    const shippingAddress = {
      streetAddress: (draft.streetAddress as string) ?? '',
      kelurahan: (draft.kelurahan as string) ?? '',
      kecamatan: (draft.kecamatan as string) ?? '',
      city: (draft.city as string) ?? '',
      province: (draft.province as string) ?? '',
      postalCode: (draft.postalCode as string) ?? '',
      rajaongkirCityId: (draft.rajaongkirCityId as string) ?? '',
      source: (draft.source as 'location_share' | 'text_input') ?? 'text_input',
    };

    // Create order record
    const [order] = await db.insert(orders).values({
      orderCode,
      tenantId: conv.tenantId,
      buyerId: buyer.id,
      conversationId: conv.id,
      productId: product.id,
      quantity: 1,
      unitPriceIdr: unitPrice,
      shippingCostIdr: shippingCost,
      totalAmountIdr: totalAmount,
      status: 'pending_payment',
      shippingAddress,
      courierCode: courier.code,
      courierService: courier.service,
      paymentMethod,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    // Create invoice via payment provider
    const provider = this.getPaymentProvider();
    const invoiceResult = await provider.createInvoice({
      orderId: order.id,
      customerName: buyer.displayName ?? buyer.waPhone,
      customerPhone: buyer.waPhone,
      items: [{ id: product.id, name: product.name, price: unitPrice, quantity: 1 }],
      grossAmount: totalAmount,
      paymentMethod,
      expiryHours: 24,
      metadata: { orderCode, tenantId: conv.tenantId },
    });

    // Store payment ID on order
    await db.update(orders)
      .set({ paymentId: invoiceResult.paymentId, updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    // Update conversation
    await db.update(conversations)
      .set({
        pendingOrderId: order.id,
        state: 'AWAITING_PAYMENT',
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conv.id));

    // Send invoice template via WhatsApp (Meta Cloud API)
    const meta = this.getMetaClient();
    const expiryStr = invoiceResult.expiresAt.toLocaleString('id-ID', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });

    if (invoiceResult.vaNumber && invoiceResult.vaBank) {
      await meta.sendTemplate({
        to: buyer.waPhone,
        templateName: 'invoice_va',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: buyer.displayName ?? 'Kak' },
            { type: 'text', text: product.name },
            { type: 'text', text: totalAmount.toLocaleString('id-ID') },
            { type: 'text', text: invoiceResult.vaBank },
            { type: 'text', text: invoiceResult.vaNumber },
            { type: 'text', text: expiryStr },
          ],
        }],
      });
    } else {
      await meta.sendTemplate({
        to: buyer.waPhone,
        templateName: 'invoice_qris',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: buyer.displayName ?? 'Kak' },
            { type: 'text', text: product.name },
            { type: 'text', text: totalAmount.toLocaleString('id-ID') },
            { type: 'text', text: expiryStr },
          ],
        }],
      });
    }

    // Enqueue payment expiry job (24hr delay)
    await this.paymentExpiryQueue.add(
      'expire-payment',
      { orderId: order.id, tenantId: conv.tenantId },
      { delay: 24 * 60 * 60 * 1000, jobId: `expire:${order.id}` },
    );

    auditLog('invoice_created', {
      orderId: order.id,
      orderCode,
      tenantId: conv.tenantId,
      paymentId: invoiceResult.paymentId,
      totalAmount,
    });
  }

  async handlePaymentWebhook(
    provider: 'midtrans' | 'xendit',
    payload: unknown,
    signature: string,
  ): Promise<void> {
    const paymentProvider = this.getPaymentProvider();

    const isValid = !signature || paymentProvider.verifyWebhook(payload, signature);
    if (!isValid) {
      throw new Error('Invalid webhook signature');
    }

    const status = paymentProvider.parseWebhookStatus(payload);

    const paymentId =
      (payload as any)?.order_id ??          // Midtrans
      (payload as any)?.external_id ??        // Xendit
      (payload as any)?.id ?? null;

    if (!paymentId) {
      throw new Error('Cannot extract paymentId from webhook payload');
    }

    if (status === 'settlement') {
      // Find the order by paymentId
      const order = await db.query.orders.findFirst({
        where: eq(orders.paymentId, paymentId),
      });
      if (order) {
        await this.handlePaymentConfirmed(paymentId, order.tenantId);
      }
    } else if (status === 'expired') {
      const order = await db.query.orders.findFirst({
        where: eq(orders.paymentId, paymentId),
      });
      if (order) {
        await this.handlePaymentExpired(order.id);
      }
    }
    // 'pending' and 'failed' are informational — no state change needed
  }

  async handlePaymentConfirmed(paymentId: string, tenantId: string): Promise<void> {
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.paymentId, paymentId), eq(orders.tenantId, tenantId)),
    });

    if (!order) {
      throw new Error(`Order not found for paymentId=${paymentId} tenantId=${tenantId}`);
    }

    // Update order status
    await db.update(orders)
      .set({ status: 'payment_confirmed', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    // Confirm inventory sale
    await this.inventoryService.confirmSale(order.productId, tenantId);

    // Update conversation state
    if (order.conversationId) {
      await db.update(conversations)
        .set({ state: 'ORDER_PROCESSING', lastMessageAt: new Date() })
        .where(eq(conversations.id, order.conversationId));
    }

    // Send PAYMENT_CONFIRMED template
    const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, order.buyerId) });
    const product = await db.query.products.findFirst({ where: eq(products.id, order.productId) });

    if (buyer && product) {
      const meta = this.getMetaClient();
      await meta.sendTemplate({
        to: buyer.waPhone,
        templateName: 'payment_confirmed',
        languageCode: 'id',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: order.orderCode },
            { type: 'text', text: product.name },
            { type: 'text', text: '1-2 hari kerja' },
          ],
        }],
      });
    }

    auditLog('payment_confirmed', {
      orderId: order.id,
      orderCode: order.orderCode,
      paymentId,
      tenantId,
      paidAt: new Date().toISOString(),
    });
  }

  async handlePaymentExpired(orderId: string): Promise<void> {
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) return;

    // Update order status
    await db.update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    // Release inventory reservation
    await this.inventoryService.releaseReservation(order.productId, order.tenantId);

    // Update conversation state
    if (order.conversationId) {
      await db.update(conversations)
        .set({ state: 'PAYMENT_EXPIRED', lastMessageAt: new Date() })
        .where(eq(conversations.id, order.conversationId));
    }

    // Send PAYMENT_EXPIRED template
    const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, order.buyerId) });
    const product = await db.query.products.findFirst({ where: eq(products.id, order.productId) });

    if (buyer && product) {
      const meta = this.getMetaClient();
      await meta.sendTemplate({
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

    auditLog('payment_expired', { orderId, tenantId: order.tenantId });
  }
}
