/**
 * @CLAUDE_CONTEXT
 * Package : packages/meta
 * File    : src/webhookParser.ts
 * Role    : Parses and normalizes Meta WhatsApp Cloud API webhook payloads.
 *           Produces MetaNormalizedPayload — a flat shape used by ConversationService.
 *           Single point of truth for reading incoming message data from Meta.
 * Exports : parseWebhook, extractFirstMessage, isTextMessage, isLocationMessage,
 *           isStatusUpdate, extractText, extractMessageId, verifyWebhookSignature
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/payments, or apps/*
 */
import { createHmac } from 'crypto';
import type {
  MetaWebhookPayload,
  MetaChangeValue,
  MetaNormalizedPayload,
} from './types';

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verify X-Hub-Signature-256 header from Meta.
 * @param rawBody  Raw request body bytes (Buffer or string)
 * @param signature  Value of X-Hub-Signature-256 header (e.g. "sha256=abc123...")
 * @param appSecret  META_APP_SECRET from your Meta App settings
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  appSecret: string,
): boolean {
  const expected = 'sha256=' + createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  // Constant-time compare to prevent timing attacks
  if (expected.length !== signature.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.equals(b);
}

// ─── Payload parsing ──────────────────────────────────────────────────────────

/**
 * Extract the first message value from a Meta webhook payload.
 * Returns null if the payload contains no inbound messages (e.g. status update only).
 */
export function extractFirstMessage(body: unknown): MetaNormalizedPayload | null {
  const payload = body as MetaWebhookPayload;
  if (payload?.object !== 'whatsapp_business_account') return null;

  for (const entry of (payload.entry ?? [])) {
    for (const change of (entry.changes ?? [])) {
      const value: MetaChangeValue = change.value;
      if (!value?.messages?.length) continue;

      const msg = value.messages[0];
      const contact = value.contacts?.[0];
      const phoneNumberId = value.metadata?.phone_number_id ?? '';

      // Resolve text content from multiple message types
      let text: string | undefined;
      if (msg.type === 'text' && msg.text?.body) {
        text = msg.text.body;
      } else if (msg.type === 'interactive') {
        text = msg.interactive?.button_reply?.title
          ?? msg.interactive?.list_reply?.title
          ?? undefined;
      } else if (msg.type === 'button' && msg.button?.text) {
        text = msg.button.text;
      }

      const location = msg.location
        ? {
            latitude: String(msg.location.latitude),
            longitude: String(msg.location.longitude),
            name: msg.location.name,
            address: msg.location.address,
          }
        : undefined;

      return {
        waId: msg.from,
        name: contact?.profile?.name,
        text,
        messageType: msg.type,
        location,
        messageId: msg.id,
        timestamp: parseInt(msg.timestamp, 10) * 1000, // convert to ms
        phoneNumberId,
        raw: msg,
      };
    }
  }

  return null;
}

/**
 * Check if the webhook contains a message status update (sent/delivered/read/failed).
 * Used to skip processing of our own outbound delivery receipts.
 */
export function isStatusUpdate(body: unknown): boolean {
  const payload = body as MetaWebhookPayload;
  if (payload?.object !== 'whatsapp_business_account') return false;
  return (payload.entry ?? []).some(e =>
    e.changes.some(c => (c.value?.statuses?.length ?? 0) > 0),
  );
}

// ─── Message type helpers ─────────────────────────────────────────────────────

export function isTextMessage(payload: MetaNormalizedPayload): boolean {
  return payload.messageType === 'text'
    || payload.messageType === 'interactive'
    || payload.messageType === 'button';
}

export function isLocationMessage(payload: MetaNormalizedPayload): boolean {
  return payload.messageType === 'location';
}

export function isImageMessage(payload: MetaNormalizedPayload): boolean {
  return payload.messageType === 'image';
}

export function isAudioMessage(payload: MetaNormalizedPayload): boolean {
  return payload.messageType === 'audio';
}

export function extractText(payload: MetaNormalizedPayload): string {
  return payload.text ?? '';
}

export function extractMessageId(payload: MetaNormalizedPayload): string {
  return payload.messageId;
}
