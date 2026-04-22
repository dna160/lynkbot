/**
 * @CLAUDE_CONTEXT
 * Package : packages/payments
 * File    : src/XenditProvider.ts
 * Role    : IPaymentProvider implementation for Xendit.
 *           Uses Xendit Invoice API for VA and QRIS.
 *           Webhook verification: compare x-callback-token header to XENDIT_WEBHOOK_TOKEN.
 * Exports : XenditProvider
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/wati, or apps/*
 */
import axios from 'axios';
import type { IPaymentProvider, CreateInvoiceParams, InvoiceResult, PaymentStatus } from './IPaymentProvider';

export class XenditProvider implements IPaymentProvider {
  private secretKey: string;
  private webhookToken: string;

  constructor() {
    this.secretKey = process.env.XENDIT_SECRET_KEY ?? '';
    this.webhookToken = process.env.XENDIT_WEBHOOK_TOKEN ?? '';
  }

  async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
    const expiresAt = new Date(Date.now() + params.expiryHours * 60 * 60 * 1000);
    const auth = Buffer.from(`${this.secretKey}:`).toString('base64');

    const body: Record<string, unknown> = {
      external_id: params.orderId,
      amount: params.grossAmount,
      payer_email: `${params.customerPhone}@wa.lynkbot.id`,
      description: params.items.map((i) => i.name).join(', '),
      invoice_duration: params.expiryHours * 3600,
      customer: { given_names: params.customerName, mobile_number: params.customerPhone },
      items: params.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    };

    if (params.paymentMethod === 'qris') {
      body.payment_methods = ['QR_CODE'];
    } else {
      const bankMap: Record<string, string> = { va_bca: 'BCA', va_mandiri: 'MANDIRI', va_bni: 'BNI', va_bri: 'BRI' };
      body.payment_methods = [bankMap[params.paymentMethod]];
    }

    const res = await axios.post('https://api.xendit.co/v2/invoices', body, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    });

    return {
      paymentId: res.data.id,
      paymentUrl: res.data.invoice_url,
      vaNumber: res.data.payment_details?.virtual_account_number,
      vaBank: res.data.payment_details?.bank_code,
      qrisImageUrl: res.data.payment_details?.qr_string ? `https://api.xendit.co/qr_codes/${res.data.payment_details.id}` : undefined,
      expiresAt,
    };
  }

  verifyWebhook(_payload: unknown, signature: string): boolean {
    return signature === this.webhookToken;
  }

  parseWebhookStatus(payload: unknown): PaymentStatus {
    const p = payload as Record<string, string>;
    const status = p.status;
    if (status === 'PAID') return 'settlement';
    if (status === 'PENDING') return 'pending';
    if (status === 'EXPIRED') return 'expired';
    return 'failed';
  }
}
