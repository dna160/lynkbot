/**
 * @CLAUDE_CONTEXT
 * Package : packages/meta
 * File    : src/index.ts
 * Role    : Public API of the @lynkbot/meta package.
 *           Meta WhatsApp Cloud API v23.0 client and webhook parser.
 * Exports : MetaClient, parser helpers, types
 */
export { MetaClient } from './MetaClient';
export {
  verifyWebhookSignature,
  extractFirstMessage,
  isStatusUpdate,
  isTextMessage,
  isLocationMessage,
  isImageMessage,
  isAudioMessage,
  extractText,
  extractMessageId,
} from './webhookParser';
export type {
  MetaWebhookPayload,
  MetaInboundMessage,
  MetaNormalizedPayload,
  MetaMessageType,
  MetaSendTextParams,
  MetaSendTemplateParams,
  MetaSendResponse,
  MetaMessageStatus,
  MetaContact,
  MetaMetadata,
} from './types';
