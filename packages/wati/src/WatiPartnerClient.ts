/**
 * @CLAUDE_CONTEXT
 * Package : packages/wati
 * File    : src/WatiPartnerClient.ts
 * Role    : WATI Partner/Reseller API for silent WABA account creation.
 *           ONLY used when WATI_PARTNER_ENABLED=true.
 *           Requires a signed WATI Partner/Reseller agreement.
 *           See PRD Section 6 — business dependency before enabling.
 * Exports : WatiPartnerClient
 * DO NOT  : Call this without WATI_PARTNER_ENABLED=true check in onboarding.service.ts
 */
import axios, { AxiosInstance } from 'axios';

export interface CreateAccountParams {
  phone: string;
  name: string;
  email: string;
  fbBusinessId: string;
  category: string;
  website?: string;
}

export interface WatiAccountResponse {
  wabaId: string;
  accountId: string;
  status: string;
  phone: string;
  name: string;
}

export class WatiPartnerClient {
  private http: AxiosInstance;

  constructor(partnerApiKey: string, partnerBaseUrl?: string) {
    this.http = axios.create({
      baseURL: partnerBaseUrl ?? process.env.WATI_PARTNER_BASE_URL ?? 'https://partner.wati.io/api/v1',
      headers: {
        Authorization: `Bearer ${partnerApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async createAccount(params: CreateAccountParams): Promise<WatiAccountResponse> {
    const res = await this.http.post('/partner/accounts', {
      phone: params.phone,
      name: params.name,
      email: params.email,
      fb_business_id: params.fbBusinessId,
      category: params.category,
      website: params.website ?? '',
    });
    return res.data;
  }

  async getAccountStatus(accountId: string): Promise<{ status: string; wabaId?: string }> {
    const res = await this.http.get(`/partner/accounts/${accountId}`);
    return { status: res.data.status, wabaId: res.data.waba_id };
  }

  async listAccounts(page = 1, limit = 20): Promise<WatiAccountResponse[]> {
    const res = await this.http.get('/partner/accounts', { params: { page, limit } });
    return res.data.accounts ?? [];
  }
}
