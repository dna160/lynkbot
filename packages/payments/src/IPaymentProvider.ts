/**
 * @CLAUDE_CONTEXT
 * Package : packages/payments
 * File    : src/IPaymentProvider.ts
 * Role    : Interface contract for all payment providers (Midtrans, Xendit).
 *           All payment logic goes through this interface — never call providers directly from apps/.
 * Exports : IPaymentProvider, CreateInvoiceParams, InvoiceResult
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/wati, or apps/*
 */

export interface CreateInvoiceParams {
  orderId: string;
  customerName: string;
  customerPhone: string;
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  grossAmount: number;
  paymentMethod: 'va_bca' | 'va_mandiri' | 'va_bni' | 'va_bri' | 'qris';
  expiryHours: number;
  metadata?: Record<string, string>;
}

export interface InvoiceResult {
  paymentId: string;
  paymentUrl?: string;
  vaNumber?: string;
  vaBank?: string;
  qrisImageUrl?: string;
  expiresAt: Date;
}

export type PaymentStatus = 'settlement' | 'pending' | 'failed' | 'expired';

export interface IPaymentProvider {
  createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult>;
  verifyWebhook(payload: unknown, signature: string): boolean;
  parseWebhookStatus(payload: unknown): PaymentStatus;
}
