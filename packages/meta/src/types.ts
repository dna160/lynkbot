/**
 * @CLAUDE_CONTEXT
 * Package : packages/meta
 * File    : src/types.ts
 * Role    : TypeScript types for Meta WhatsApp Cloud API v23.0 payloads.
 *           Raw webhook shapes exactly as Meta sends them.
 *           Normalized shape (MetaNormalizedPayload) is what the app uses internally.
 * Exports : Raw Meta types + MetaNormalizedPayload
 */

// ─── Raw Meta webhook payload ─────────────────────────────────────────────────

export interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: MetaEntry[];
}

export interface MetaEntry {
  id: string; // WABA ID
  changes: MetaChange[];
}

export interface MetaChange {
  value: MetaChangeValue;
  field: 'messages';
}

export interface MetaChangeValue {
  messaging_product: 'whatsapp';
  metadata: MetaMetadata;
  contacts?: MetaContact[];
  messages?: MetaInboundMessage[];
  statuses?: MetaMessageStatus[];
  errors?: MetaError[];
}

export interface MetaMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface MetaContact {
  profile: { name: string };
  wa_id: string;
}

export interface MetaInboundMessage {
  from: string;         // sender WA ID (E.164 without +)
  id: string;           // wamid — unique message ID
  timestamp: string;    // unix epoch string
  type: MetaMessageType;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type: string; sha256: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; caption?: string; mime_type: string };
  document?: { id: string; filename?: string; mime_type: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { text: string; payload: string };
  sticker?: { id: string; mime_type: string; animated: boolean };
  reaction?: { message_id: string; emoji: string };
  contacts?: Array<{ name: { formatted_name: string }; phones?: Array<{ phone: string; type: string }> }>;
  referral?: { source_url: string; source_id: string; source_type: string; headline: string; body: string };
  errors?: MetaError[];
}

export type MetaMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'location'
  | 'interactive'
  | 'button'
  | 'sticker'
  | 'reaction'
  | 'contacts'
  | 'order'
  | 'system'
  | 'unknown'
  | 'unsupported';

export interface MetaMessageStatus {
  id: string;       // wamid of our outbound message
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
  timestamp: string;
  recipient_id: string;
  conversation?: { id: string; origin: { type: string } };
  pricing?: { billable: boolean; pricing_model: string; category: string };
  errors?: MetaError[];
}

export interface MetaError {
  code: number;
  title: string;
  message?: string;
  error_data?: { details: string };
}

// ─── Normalized payload — used internally by ConversationService ──────────────
// Maps Meta's nested structure to a flat shape similar to the old WATI payload.

export interface MetaNormalizedPayload {
  /** Sender's WhatsApp ID — E.164 without + (e.g. "6281947888808") */
  waId: string;
  /** Sender's display name from contacts array */
  name?: string;
  /** Plain text content of the message (text body, button/list reply title) */
  text?: string;
  /** Meta message type string */
  messageType: MetaMessageType;
  /** Location data, present when messageType === 'location' */
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  /** The wamid — unique message identifier */
  messageId: string;
  /** Unix epoch in milliseconds */
  timestamp: number;
  /** Phone number ID of the business number that received the message */
  phoneNumberId: string;
  /** Raw Meta message object for advanced usage */
  raw: MetaInboundMessage;
}

// ─── Send message types ───────────────────────────────────────────────────────

export interface MetaSendTextParams {
  to: string;       // recipient WA ID (E.164 without +)
  message: string;
  isWithin24hrWindow: boolean;
}

export interface MetaSendTemplateParams {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: MetaTemplateComponent[];
}

export interface MetaTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: Array<{
    type: 'text' | 'image' | 'document' | 'video' | 'currency' | 'date_time';
    text?: string;
    image?: { link: string };
  }>;
}

export interface MetaSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}
