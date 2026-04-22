/**
 * @CLAUDE_CONTEXT
 * Package : packages/wati
 * File    : src/webhookParser.ts
 * Role    : Parses and normalizes inbound WATI webhook payloads into typed objects.
 *           Single point of truth for reading WA message data.
 * Exports : parseWebhook(), isLocationMessage(), isTextMessage(), extractText(), extractMessageId()
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/payments, or apps/*
 */
import { WatiWebhookSchema } from '@lynkbot/shared';
import type { WatiWebhookPayload } from '@lynkbot/shared';

export function parseWebhook(body: unknown): WatiWebhookPayload {
  return WatiWebhookSchema.parse(body);
}

export function isLocationMessage(payload: WatiWebhookPayload): boolean {
  return payload.messageType === 'location' && !!payload.location;
}

export function isTextMessage(payload: WatiWebhookPayload): boolean {
  const type = payload.messageType?.toLowerCase();
  return type === 'text' || type === 'interactive' || (!type && !!payload.text);
}

export function isImageMessage(payload: WatiWebhookPayload): boolean {
  return payload.messageType === 'image';
}

export function extractText(payload: WatiWebhookPayload): string {
  if (payload.text) return payload.text.trim();
  if (payload.listReply && typeof payload.listReply === 'object') {
    return (payload.listReply as Record<string, unknown>).title as string ?? '';
  }
  if (payload.buttonReply && typeof payload.buttonReply === 'object') {
    return (payload.buttonReply as Record<string, unknown>).title as string ?? '';
  }
  return '';
}

export function extractMessageId(payload: WatiWebhookPayload): string {
  return payload.messageId ?? payload.id ?? `${payload.waId}_${payload.timestamp ?? Date.now()}`;
}

export function isWithin24HourWindow(lastSessionAt: Date | null | undefined): boolean {
  if (!lastSessionAt) return false;
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return lastSessionAt > twentyFourHoursAgo;
}
