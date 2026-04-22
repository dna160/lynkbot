/**
 * @CLAUDE_CONTEXT
 * Package : packages/payments
 * File    : src/MidtransProvider.ts
 * Role    : IPaymentProvider implementation for Midtrans.
 *           Supports VA (BCA, Mandiri, BNI, BRI) and QRIS.
 *           Webhook verification: SHA512(orderId + statusCode + grossAmount + serverKey)
 * Exports : MidtransProvider
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/wati, or apps/*
 */
import axios from 'axios';
import { createHash } from 'crypto';
import type { IPaymentProvider, CreateInvoiceParams, InvoiceResult, PaymentStatus } from './IPaymentProvider';

const MIDTRANS_BANK_MAP: Record<string, string> = {
  va_bca: 'bca',
  va_mandiri: 'mandiri',
  va_bni: 'bni',
  va_bri: 'bri',
};

export class MidtransProvider implements IPaymentProvider {
  private serverKey: string;
  private clientKey: string;
  private isProduction: boolean;
  private baseUrl: string;

  constructor() {
    this.serverKey = process.env.MIDTRANS_SERVER_KEY ?? '';
    this.clientKey = process.env.MIDTRANS_CLIENT_KEY ?? '';
    this.isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    this.baseUrl = this.isProduction
      ? 'https://api.midtrans.com/v2'
      : 'https://api.sandbox.midtrans.com/v2';
  }

  async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
    const expiresAt = new Date(Date.now() + params.expiryHours * 60 * 60 * 1000);

    const body: Record<string, unknown> = {
      transaction_details: {
        order_id: params.orderId,
        gross_amount: params.grossAmount,
      },
      customer_details: {
        first_name: params.customerName,
        phone: params.customerPhone,
      },
      item_details: params.items.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      expiry: {
        start_time: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0700',
        unit: 'hour',
        duration: params.expiryHours,
      },
    };

    if (params.paymentMethod === 'qris') {
      body.payment_type = 'qris';
      body.qris = { acquirer: 'gopay' };
    } else {
      const bank = MIDTRANS_BANK_MAP[params.paymentMethod];
      body.payment_type = 'bank_transfer';
      body.bank_transfer = { bank };
    }

    const auth = Buffer.from(`${this.serverKey}:`).toString('base64');
    const res = await axios.post(`${this.baseUrl}/charge`, body, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    });

    const data = res.data;

    if (params.paymentMethod === 'qris') {
      return {
        paymentId: data.transaction_id,
        qrisImageUrl: data.actions?.find((a: Record<string, string>) => a.name === 'generate-qr-code')?.url,
        expiresAt,
      };
    }

    const vaInfo = data.va_numbers?.[0] ?? {};
    return {
      paymentId: data.transaction_id,
      vaNumber: vaInfo.va_number,
      vaBank: vaInfo.bank?.toUpperCase(),
      expiresAt,
    };
  }

  verifyWebhook(payload: unknown, _signature: string): boolean {
    const p = payload as Record<string, string>;
    const hash = createHash('sha512')
      .update(`${p.order_id}${p.status_code}${p.gross_amount}${this.serverKey}`)
      .digest('hex');
    return hash === p.signature_key;
  }

  parseWebhookStatus(payload: unknown): PaymentStatus {
    const p = payload as Record<string, string>;
    const status = p.transaction_status;
    const fraudStatus = p.fraud_status;

    if (status === 'capture' && fraudStatus === 'accept') return 'settlement';
    if (status === 'settlement') return 'settlement';
    if (status === 'pending') return 'pending';
    if (status === 'expire') return 'expired';
    if (['deny', 'cancel', 'failure'].includes(status)) return 'failed';
    return 'pending';
  }
}
