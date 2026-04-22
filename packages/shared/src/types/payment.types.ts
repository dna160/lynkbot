/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/types/payment.types.ts
 * Role    : Payment TypeScript types
 * Imports : nothing (zero deps)
 * Exports : PaymentMethod, PaymentStatus, InvoiceResult
 * DO NOT  : Import from @lynkbot/* or apps/*
 */

export type PaymentMethod = 'va_bca' | 'va_mandiri' | 'va_bni' | 'va_bri' | 'qris';
export type PaymentStatus = 'settlement' | 'pending' | 'failed' | 'expired';

export interface PaymentInvoice {
  paymentId: string;
  paymentUrl?: string;
  vaNumber?: string;
  vaBank?: string;
  qrisImageUrl?: string;
  expiresAt: Date;
}
