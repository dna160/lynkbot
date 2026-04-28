/**
 * @CLAUDE_CONTEXT
 * Package : packages/meta
 * File    : src/MetaClient.ts
 * Role    : Meta WhatsApp Cloud API v23.0 client.
 *           Sends messages via the Graph API using a System User access token.
 *           COMPLIANCE: sendText() throws if isWithin24hrWindow=false (no freeform outside session).
 *           Use sendTemplate() for re-engagement outside the 24hr window.
 * Exports : MetaClient
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/payments, or apps/*
 */
import axios, { AxiosInstance } from 'axios';
import type {
  MetaSendTextParams,
  MetaSendTemplateParams,
  MetaSendResponse,
} from './types';

const META_API_VERSION = 'v23.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export class MetaClient {
  private http: AxiosInstance;
  private phoneNumberId: string;

  constructor(accessToken: string, phoneNumberId: string) {
    this.phoneNumberId = phoneNumberId;
    this.http = axios.create({
      baseURL: META_BASE_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  /**
   * Send a freeform text message.
   * Throws if isWithin24hrWindow is false — Meta blocks freeform outside the 24h session window.
   * Use sendTemplate() for outbound re-engagement.
   */
  async sendText(params: MetaSendTextParams): Promise<MetaSendResponse> {
    if (!params.isWithin24hrWindow) {
      throw new Error(
        `Cannot send freeform text to ${params.to} — outside 24hr session window. Use sendTemplate() instead.`,
      );
    }

    const { data } = await this.http.post<MetaSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.to,
        type: 'text',
        text: { body: params.message, preview_url: false },
      },
    );
    return data;
  }

  /**
   * Send a WhatsApp-approved template message.
   * Safe to use outside the 24hr window for order confirmations, payment links, etc.
   */
  async sendTemplate(params: MetaSendTemplateParams): Promise<MetaSendResponse> {
    const { data } = await this.http.post<MetaSendResponse>(
      `/${this.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.to,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: params.languageCode ?? 'id' },
          components: params.components ?? [],
        },
      },
    );
    return data;
  }

  /**
   * Mark an incoming message as read.
   * Sends the double-blue-tick to the user.
   */
  async markRead(messageId: string): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  /**
   * Get the phone number details registered to this phoneNumberId.
   * Useful for verifying the number is active.
   */
  async getPhoneNumberInfo(): Promise<{
    id: string;
    display_phone_number: string;
    verified_name: string;
    quality_rating: string;
    status: string;
  }> {
    const { data } = await this.http.get(`/${this.phoneNumberId}`, {
      params: { fields: 'id,display_phone_number,verified_name,quality_rating,status' },
    });
    return data;
  }

  /**
   * Test that the access token and phone number ID are valid.
   * Returns { ok: true, phoneNumber } on success, { ok: false, error } on failure.
   */
  async testConnection(): Promise<{ ok: boolean; phoneNumber?: string; error?: string }> {
    try {
      const info = await this.getPhoneNumberInfo();
      return { ok: true, phoneNumber: info.display_phone_number };
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ?? err.message
        : String(err);
      return { ok: false, error: msg };
    }
  }

  /**
   * Fetch all Meta-approved message templates for a WABA.
   * Only returns templates with status APPROVED.
   * wabaId = META_WABA_ID from env.
   */
  async listTemplates(wabaId: string): Promise<Array<{
    name: string;
    status: string;
    language: string;
    category: string;
    components: Array<{ type: string; text?: string; format?: string; buttons?: unknown[] }>;
  }>> {
    const { data } = await this.http.get(`/${wabaId}/message_templates`, {
      params: { fields: 'name,status,language,category,components', limit: 100 },
    });
    const templates = (data.data ?? []) as Array<{
      name: string; status: string; language: string; category: string;
      components: Array<{ type: string; text?: string; format?: string; buttons?: unknown[] }>;
    }>;
    return templates.filter(t => t.status === 'APPROVED');
  }
}
