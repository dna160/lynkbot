/**
 * @CLAUDE_CONTEXT
 * Package : packages/wati
 * File    : src/index.ts
 * Role    : Public API re-exports for @lynkbot/wati package
 */
export { WatiClient } from './WatiClient';
export type { SendTemplateParams, SendTextParams } from './WatiClient';
export { WatiPartnerClient } from './WatiPartnerClient';
export type { CreateAccountParams, WatiAccountResponse } from './WatiPartnerClient';
export { parseWebhook, isLocationMessage, isTextMessage, isImageMessage, extractText, extractMessageId, isWithin24HourWindow } from './webhookParser';
export { TEMPLATES } from './templates';
export type { TemplateName } from './templates';
