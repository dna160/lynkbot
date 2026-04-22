/**
 * @CLAUDE_CONTEXT
 * Package : packages/wati
 * File    : src/templates.ts
 * Role    : Single registry of all 9 approved WA HSM templates.
 *           Template IDs assigned by Meta after approval — update when approved.
 *           NEVER hardcode template names elsewhere — always reference TEMPLATES here.
 *           Submit all templates to Meta via WATI console minimum 2 weeks before go-live.
 * Exports : TEMPLATES, TemplateName
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/payments, or apps/*
 */

export const TEMPLATES = {
  INVOICE_VA: {
    name: 'lynkbot_invoice_va',
    // Bahasa: 'Halo {{1}}, invoice untuk *{{2}}* sudah siap!\n\nTotal: *Rp {{3}}*\nVA {{4}}: {{5}}\nBerlaku sampai: {{6}}'
    params: ['buyerName', 'productName', 'totalAmount', 'bankName', 'vaNumber', 'expiryTime'] as const,
  },
  INVOICE_QRIS: {
    name: 'lynkbot_invoice_qris',
    // Bahasa: 'Halo {{1}}, scan QRIS untuk bayar *{{2}}*. Total: *Rp {{3}}*. Berlaku: {{4}}'
    params: ['buyerName', 'productName', 'totalAmount', 'expiryTime'] as const,
  },
  PAYMENT_CONFIRMED: {
    name: 'lynkbot_payment_confirmed',
    // Bahasa: 'Pembayaran untuk order *{{1}}* ({{2}}) telah dikonfirmasi! Estimasi proses: {{3}}'
    params: ['orderCode', 'productName', 'estimatedDispatch'] as const,
  },
  ORDER_SHIPPED: {
    name: 'lynkbot_order_shipped',
    // Bahasa: 'Paketmu sudah dikirim via *{{1}}*! Resi: {{2}}\nCek: {{3}}\nEstimasi tiba: {{4}}'
    params: ['courierName', 'resiNumber', 'trackingUrl', 'estimatedArrival'] as const,
  },
  OUT_FOR_DELIVERY: {
    name: 'lynkbot_out_for_delivery',
    // Bahasa: 'Paket *{{1}}* sedang dalam perjalanan ke alamatmu hari ini! 🚚'
    params: ['productName'] as const,
  },
  DELIVERED: {
    name: 'lynkbot_delivered',
    // Bahasa: '*{{1}}* sudah sampai! Semoga bermanfaat ya 😊 — {{2}}'
    params: ['productName', 'lynkerSocialHandle'] as const,
  },
  PAYMENT_EXPIRED: {
    name: 'lynkbot_payment_expired',
    // Bahasa: 'Hai {{1}}, invoice untuk *{{2}}* sudah kadaluarsa. Ketik YA untuk buat invoice baru.'
    params: ['buyerName', 'productName'] as const,
  },
  RESTOCK_NOTIFY: {
    name: 'lynkbot_restock_notify',
    // Bahasa: 'Kabar baik! *{{1}}* yang kamu tunggu sudah tersedia kembali. Mau order sekarang?'
    params: ['productName'] as const,
  },
  SHIPPING_EXCEPTION: {
    name: 'lynkbot_shipping_exception',
    // Bahasa: 'Ada kendala pengiriman order {{1}}. Status: {{2}} ({{3}}, resi: {{4}}). Tim kami akan follow up.'
    params: ['orderCode', 'statusDescription', 'courierName', 'resiNumber'] as const,
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;
