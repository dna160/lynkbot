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

    const channelNum = params.channelPhoneNumber ?? this.defaultChannelNumber;
    const phone = encodeURIComponent(params.phone);
    const queryParams: Record<string, string> = {};
    if (channelNum) queryParams.channelPhoneNumber = channelNum;

    // Strategy: try v2 (JSON body — matches WATI dashboard's internal send) first, fall back to
    // v1 (query param — legacy endpoint). Some WATI accounts route v1/v2 through different Meta
    // Cloud API apps; only one may have the WABA display name approved (Meta error #131037).
    const attempts: Array<{ label: string; url: string; body: unknown; queryOnly?: boolean }> = [
      {
        label: 'v2',
        url: `/api/v2/sendSessionMessage/${phone}`,
        body: { messageText: params.message },
      },
      {
        label: 'v1',
        url: `/api/v1/sendSessionMessage/${phone}`,
        body: null,
        queryOnly: true,
      },
    ];

    let lastDetail = 'Unknown WATI send error';
    for (const attempt of attempts) {
      try {
        const reqQuery = attempt.queryOnly
          ? { ...queryParams, messageText: params.message }
          : queryParams;
        const res = await this.http.post(attempt.url, attempt.body, { params: reqQuery });
        // WATI returns HTTP 200 even on Meta-side failure — check body.
        if (res.data?.result === true || res.data?.ok === true) return;
        const detail =
          res.data?.message?.failedDetail ??
          res.data?.info ??
          res.data?.error ??
          JSON.stringify(res.data ?? {});
        lastDetail = `[${attempt.label}] ${detail}`;
        // If this is a non-display-name failure, stop trying — fallback won't help.
        if (!String(detail).includes('131037')) break;
      } catch (err) {
        lastDetail = `[${attempt.label}] ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    throw new Error(`WATI sendSessionMessage failed: ${lastDetail}`);
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
