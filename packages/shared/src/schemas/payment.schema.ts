/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/schemas/payment.schema.ts
 * Role    : Zod schemas for payment-related payloads
 * Imports : zod only
 * Exports : CreateInvoiceSchema, PaymentWebhookSchema
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
import { z } from 'zod';

export const PaymentMethodSchema = z.enum(['va_bca', 'va_mandiri', 'va_bni', 'va_bri', 'qris']);

export const CreateInvoiceSchema = z.object({
  orderId: z.string().uuid(),
  customerName: z.string(),
  customerPhone: z.string(),
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().positive(),
    quantity: z.number().positive().int(),
  })),
  grossAmount: z.number().positive(),
  paymentMethod: PaymentMethodSchema,
  expiryHours: z.number().positive().default(24),
  metadata: z.record(z.string()).optional(),
});

export const MidtransWebhookSchema = z.object({
  transaction_id: z.string(),
  order_id: z.string(),
  payment_type: z.string(),
  transaction_status: z.string(),
  fraud_status: z.string().optional(),
  gross_amount: z.string(),
  status_code: z.string(),
  signature_key: z.string(),
  va_numbers: z.array(z.object({
    bank: z.string(),
    va_number: z.string(),
  })).optional(),
  qr_string: z.string().optional(),
  expiry_time: z.string().optional(),
});

export const XenditWebhookSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  status: z.string(),
  payment_method: z.string().optional(),
  paid_amount: z.number().optional(),
  paid_at: z.string().optional(),
  amount: z.number(),
  description: z.string().optional(),
  expiry_date: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type MidtransWebhookPayload = z.infer<typeof MidtransWebhookSchema>;
export type XenditWebhookPayload = z.infer<typeof XenditWebhookSchema>;
