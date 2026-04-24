/**
 * @CLAUDE_CONTEXT
 * Package : packages/wati
 * File    : src/WatiClient.ts
 * Role    : WATI BSP REST API client. All WA messaging goes through this only.
 *           COMPLIANCE: sendText() throws if isWithin24hrWindow=false.
 *           Template-only outbound outside the 24hr user-initiated window.
 * Exports : WatiClient
 * DO NOT  : Import from @lynkbot/db, @lynkbot/ai, @lynkbot/payments, apps/*
 *           Never bypass the 24hr window check in sendText().
 */
import axios, { AxiosInstance } from 'axios';
import { TEMPLATES, TemplateName } from './templates';

export interface SendTemplateParams {
  phone: string;
  templateName: TemplateName;
  parameters: string[];
  broadcastName?: string;
}

export interface SendTextParams {
  phone: string;
  message: string;
  isWithin24hrWindow: boolean;
  /** Pass when the WATI account has multiple numbers — routes the send via the correct channel. */
  channelPhoneNumber?: string;
}

export class WatiClient {
  private http: AxiosInstance;
  /** Default channel number used when the WATI account has multiple numbers. */
  private defaultChannelNumber?: string;

  constructor(apiKey: string, baseUrl?: string, channelPhoneNumber?: string) {
    this.defaultChannelNumber = channelPhoneNumber;
    this.http = axios.create({
      baseURL: baseUrl ?? process.env.WATI_BASE_URL ?? 'https://live-server.wati.io',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  async sendTemplate(params: SendTemplateParams): Promise<void> {
    const template = TEMPLATES[params.templateName];
    if (!template) throw new Error(`Unknown template: ${params.templateName}`);

    await this.http.post(
      '/api/v1/sendTemplateMessage',
      {
        template_name: template.name,
        broadcast_name: params.broadcastName ?? `lynkbot_${Date.now()}`,
        parameters: params.parameters.map((value, i) => ({
          name: template.params[i] ?? `param${i + 1}`,
          value,
        })),
      },
      { params: { whatsappNumber: params.phone } },
    );
  }

  async sendText(params: SendTextParams): Promise<void> {
    if (!params.isWithin24hrWindow) {
      throw new Error(
        'COMPLIANCE VIOLATION: Cannot send freeform message outside 24hr window. Use sendTemplate() instead.',
      );
    }
    // phone goes in the path; messageText is a query param (WATI API spec)
    const queryParams: Record<string, string> = { messageText: params.message };
    const channelNum = params.channelPhoneNumber ?? this.defaultChannelNumber;
    if (channelNum) {
      queryParams.channelPhoneNumber = channelNum;
    }
    const res = await this.http.post(
      `/api/v1/sendSessionMessage/${encodeURIComponent(params.phone)}`,
      null,
      { params: queryParams },
    );
    // WATI returns HTTP 200 even on failure — check the body
    if (res.data?.ok === false) {
      const detail = res.data?.message?.failedDetail ?? res.data?.error ?? 'Unknown WATI send error';
      throw new Error(`WATI sendSessionMessage failed: ${detail}`);
    }
  }

  async markAsRead(messageId: string, phone: string): Promise<void> {
    await this.http.post('/api/v1/markMessageRead', {
      messageId,
      whatsappNumber: phone,
    });
  }

  async getContacts(pageSize = 100, pageNumber = 1): Promise<unknown[]> {
    const res = await this.http.get('/api/v1/getContacts', {
      params: { pageSize, pageNumber },
    });
    return res.data?.contact ?? [];
  }
}
