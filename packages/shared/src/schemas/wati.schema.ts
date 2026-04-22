/**
 * @CLAUDE_CONTEXT
 * Package : packages/shared
 * File    : src/schemas/wati.schema.ts
 * Role    : Zod schemas for all WATI webhook payloads
 * Imports : zod only
 * Exports : WatiWebhookSchema, WatiMessageSchema, WatiWebhookPayload
 * DO NOT  : Import from @lynkbot/* or apps/*
 */
import { z } from 'zod';

export const WaLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
});

export const WatiMessageSchema = z.object({
  id: z.string(),
  created: z.string().optional(),
  conversationId: z.string().optional(),
  ticketId: z.string().optional(),
  text: z.string().optional(),
  type: z.string().optional(),
  data: z.unknown().optional(),
  timestamp: z.string().optional(),
  owner: z.boolean().optional(),
  eventType: z.string().optional(),
  statusString: z.string().optional(),
  avatarUrl: z.string().optional(),
  assignedId: z.string().optional(),
  operatorName: z.string().optional(),
  operatorEmail: z.string().optional(),
  waId: z.string().optional(),
  messageContact: z.unknown().optional(),
  senderName: z.string().optional(),
  senderObj: z.unknown().optional(),
});

export const WatiWebhookSchema = z.object({
  waId: z.string(),
  id: z.string().optional(),
  messageId: z.string().optional(),
  type: z.string().optional(),
  messageType: z.string().default('text'),
  text: z.string().optional(),
  timestamp: z.string().optional(),
  senderName: z.string().optional(),
  location: WaLocationSchema.optional(),
  contactName: z.string().optional(),
  listReply: z.unknown().optional(),
  buttonReply: z.unknown().optional(),
  mediaUrl: z.string().optional(),
  mimeType: z.string().optional(),
  caption: z.string().optional(),
  isDeleted: z.boolean().optional(),
  isFailed: z.boolean().optional(),
  isForwarded: z.boolean().optional(),
  // owner: true = message FROM the buyer (inbound), false = sent BY operator (outbound)
  owner: z.boolean().optional(),
  eventType: z.string().optional(),
  statusString: z.string().optional(),
  operatorName: z.string().optional(),
  operatorEmail: z.string().optional(),
});

export type WatiWebhookPayload = z.infer<typeof WatiWebhookSchema>;
export type WaLocationPayload = z.infer<typeof WaLocationSchema>;
