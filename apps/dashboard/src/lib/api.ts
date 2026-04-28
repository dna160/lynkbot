import axios from 'axios';

declare global {
  interface Window { __LYNKBOT_API_URL__?: string; }
}

// Priority: runtime config.js (set by nginx from API_URL env var)
//           → Vite build-time VITE_API_URL (if someone sets it as a build var)
//           → localhost fallback for local dev
const BASE_URL =
  window.__LYNKBOT_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:3000';

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lynkbot_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('lynkbot_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export function getTenantIdFromToken(): string | null {
  const token = localStorage.getItem('lynkbot_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return (payload.tenantId as string) ?? null;
  } catch {
    return null;
  }
}

export type OrderStatus =
  | 'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

export type ConvState =
  | 'INIT' | 'GREETING' | 'BROWSING' | 'PRODUCT_INQUIRY' | 'OBJECTION_HANDLING'
  | 'CHECKOUT_INTENT' | 'ADDRESS_COLLECTION' | 'LOCATION_RECEIVED' | 'SHIPPING_CALC'
  | 'PAYMENT_METHOD_SELECT' | 'INVOICE_GENERATION' | 'AWAITING_PAYMENT'
  | 'PAYMENT_CONFIRMED' | 'ORDER_PROCESSING' | 'OUT_OF_STOCK' | 'SHIPPED'
  | 'TRACKING' | 'DELIVERED' | 'COMPLETED' | 'ESCALATED' | 'CLOSED_LOST'
  | 'PAYMENT_EXPIRED';

export interface Tenant {
  id: string;
  lynkUserId: string;
  storeName: string;
  originCityName?: string | null;
  originCityId?: string | null;
  displayPhoneNumber?: string | null;
  metaBusinessId?: string | null;
  paymentAccountId?: string | null;
  watiAccountStatus: 'pending' | 'registering' | 'pending_verification' | 'active' | 'suspended' | 'manual_required';
  subscriptionTier: 'trial' | 'growth' | 'pro' | 'scale';
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  sku?: string;
  description?: string;
  priceIdr: number;
  weightGrams: number;
  isActive: boolean;
  knowledgeStatus: 'pending' | 'processing' | 'ready' | 'failed';
  coverImageUrl?: string;
  createdAt: string;
}

export interface InventoryItem {
  productId: string;
  quantityAvailable: number;
  quantityReserved: number;
  quantitySold: number;
  lowStockThreshold: number;
}

export interface Order {
  id: string;
  orderCode: string;
  tenantId: string;
  buyerId: string;
  productId: string;
  status: OrderStatus;
  totalAmountIdr: number;
  shippingCostIdr: number;
  resiNumber?: string;
  courierCode?: string;
  createdAt: string;
  buyer?: { waPhone: string; displayName?: string };
  product?: { name: string };
}

export interface Conversation {
  id: string;
  tenantId: string;
  buyerId: string;
  state: ConvState;
  isHumanTakeover: boolean;
  isActive: boolean;
  productId?: string;
  messageCount: number;
  lastMessageAt: string;
  startedAt: string;
  buyer?: { waPhone: string; displayName?: string };
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  textContent: string | null;
  mediaUrl: string | null;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  conversionRate: number;
  avgOrderValue: number;
  avgResponseTimeSec: number;
  revenueOverTime: { date: string; revenue: number }[];
  topProducts: { productId: string; name: string; unitsSold: number; revenue: number; conversionRate: number }[];
  funnelData: { stage: string; count: number }[];
}

export interface CreateProductPayload {
  name: string;
  sku?: string;
  description?: string;
  priceIdr: number;
  weightGrams: number;
}

export const authApi = {
  login: (email: string, _password: string) =>
    api.post<{ token: string }>('/auth/login', { lynkUserId: email }),
  me: () => api.get<{ tenantId: string; lynkUserId: string }>('/auth/me'),
};

export const tenantApi = {
  getMe: (): Promise<{ data: Tenant }> => {
    const tenantId = getTenantIdFromToken();
    if (!tenantId) return Promise.reject(new Error('Not authenticated'));
    return api.get<Tenant>(`/tenants/${tenantId}`);
  },
  updateMe: (data: Partial<Pick<Tenant, 'storeName' | 'originCityName' | 'originCityId' | 'displayPhoneNumber' | 'metaBusinessId' | 'paymentAccountId'>>) => {
    const tenantId = getTenantIdFromToken();
    if (!tenantId) return Promise.reject(new Error('Not authenticated'));
    return api.patch<Tenant>(`/tenants/${tenantId}`, data);
  },
  onboard: () => {
    const tenantId = getTenantIdFromToken();
    if (!tenantId) return Promise.reject(new Error('Not authenticated'));
    return api.post(`/tenants/${tenantId}/onboard`);
  },
};

export const productsApi = {
  list: () => api.get<Product[]>('/products'),
  get: (id: string) => api.get<Product>(`/products/${id}`),
  create: (data: CreateProductPayload) => api.post<Product>('/products', data),
  update: (id: string, data: Partial<Product>) => api.patch<Product>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  /**
   * Upload a PDF directly to the API (multipart). Works without S3 credentials —
   * the server saves to local disk when S3 is not configured.
   */
  uploadPdf: (id: string, file: File, onProgress?: (pct: number) => void) =>
    new Promise<{ s3Key: string; storage: 'local' | 's3' }>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      const xhr = new XMLHttpRequest();
      const token = localStorage.getItem('lynkbot_token');
      xhr.open('POST', `${BASE_URL}/api/v1/products/${id}/upload-pdf`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          const msg = (() => { try { return JSON.parse(xhr.responseText)?.error; } catch { return null; } })();
          reject(new Error(msg ?? `Upload failed: HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    }),
  /** Enqueue the RAG ingest job for a product's PDF. */
  triggerIngest: (id: string) => api.post(`/products/${id}/ingest`),
};

export const inventoryApi = {
  list: () => api.get<InventoryItem[]>('/inventory'),
  update: (productId: string, data: { quantityAvailable: number; lowStockThreshold: number }) =>
    api.patch<InventoryItem>(`/inventory/${productId}`, data),
};

export const ordersApi = {
  list: (params?: { status?: string; page?: number; limit?: number; search?: string }) =>
    api.get<{ items: Order[]; total: number }>('/orders', { params }),
  get: (id: string) => api.get<Order>(`/orders/${id}`),
  updateResi: (id: string, resiNumber: string, courierCode: string) =>
    api.post<Order>(`/orders/${id}/resi`, { resiNumber, courierCode }),
};

export const conversationsApi = {
  list: (params?: { state?: string; isActive?: string; page?: number; limit?: number }) =>
    api.get<{ items: Conversation[]; total: number }>('/conversations', { params }),
  get: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
  sendMessage: (id: string, text: string) => api.post<Message>(`/conversations/${id}/send-message`, { text }),
  takeover: (id: string) => api.post(`/conversations/${id}/takeover`),
  returnToBot: (id: string) => api.post(`/conversations/${id}/return-to-bot`),
};

interface _DashboardKpis { totalOrders: number; revenue: number; conversionRate: number; avgResponseTimeSec: number; }
interface _FunnelRow { state: string; count: number }
interface _TimeRow { date: string; count: number; revenue: number }
interface _ProductRow { productId: string; name: string; unitsSold: number; revenue: number; conversionRate: number; }

export const analyticsApi = {
  overview: async (days = 30): Promise<{ data: AnalyticsData }> => {
    const [kpisRes, funnelRes, timeRes, productsRes] = await Promise.all([
      api.get<_DashboardKpis>('/analytics/dashboard'),
      api.get<_FunnelRow[]>('/analytics/funnel'),
      api.get<_TimeRow[]>('/analytics/orders-over-time', { params: { days } }),
      api.get<_ProductRow[]>('/analytics/top-products'),
    ]);
    const k = kpisRes.data;
    const data: AnalyticsData = {
      totalOrders: k.totalOrders,
      totalRevenue: k.revenue,
      conversionRate: k.conversionRate,
      avgOrderValue: k.totalOrders > 0 ? Math.round(k.revenue / k.totalOrders) : 0,
      avgResponseTimeSec: k.avgResponseTimeSec,
      revenueOverTime: timeRes.data.map((r) => ({ date: r.date, revenue: r.revenue })),
      topProducts: productsRes.data,
      funnelData: funnelRes.data.map((r) => ({ stage: r.state.replace(/_/g, ' '), count: r.count })),
    };
    return { data };
  },
};

export interface Buyer {
  id: string;
  tenantId: string;
  waPhone: string;
  displayName?: string;
  tags?: string[];
  notes?: string;
  preferredLanguage?: string;
  doNotContact: boolean;
  totalOrders?: number;
  totalSpendIdr?: number;
  createdAt: string;
  updatedAt: string;
}

export const buyersApi = {
  list: (params?: { search?: string; page?: number; limit?: number }) =>
    api.get<{ items: Buyer[]; total: number; page: number; limit: number }>('/buyers', { params }),
  update: (id: string, data: { displayName?: string; doNotContact?: boolean }) =>
    api.patch<Buyer>(`/buyers/${id}`, data),
  delete: (id: string) => api.delete(`/buyers/${id}`),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ imported: number; skipped: number; total: number; errors: string[] }>('/buyers/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export interface ProductCopy {
  description: string;
  tagline: string;
  keyOutcomes: string[];
  problemsSolved: string[];
  faqPairs: { q: string; a: string }[];
  bookPersonaPrompt: string;
  _meta?: { modelId: string; tokensUsed: number; latencyMs: number };
}

export const aiApi = {
  generateProductCopy: (data: { name: string; brief?: string; existingDescription?: string; language?: 'id' | 'en' }) =>
    api.post<ProductCopy>('/ai/generate-product-copy', data),
  chat: (message: string, context?: string) =>
    api.post<{ reply: string }>('/ai/chat', { message, context }),
  suggestReply: (data: { messages: { role: 'user' | 'assistant'; content: string }[] }) =>
    api.post<{ reply: string }>('/ai/chat', {
      message: 'Suggest a helpful short reply for the human operator to send in this WhatsApp conversation.',
      context: JSON.stringify(data.messages),
    }),
};

export interface BroadcastTemplate { key: string; name: string; params: string[]; }

export interface Broadcast {
  id: string;
  tenantId: string;
  templateName: string;
  status: 'pending' | 'sending' | 'completed' | 'failed';
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export const broadcastsApi = {
  templates: () => api.get<{ templates: BroadcastTemplate[] }>('/broadcasts/templates'),
  list: (params?: { page?: number; limit?: number }) =>
    api.get<{ items: Broadcast[]; page: number; limit: number }>('/broadcasts', { params }),
  create: (data: { templateKey: string; parameters: string[]; audienceFilter?: { tags?: string[] } }) =>
    api.post<{ id: string; recipientCount: number; status: string }>('/broadcasts', data),
  get: (id: string) => api.get<Broadcast>(`/broadcasts/${id}`),
};

// ── Pantheon Intelligence ────────────────────────────────────────────────────

export interface GenomeScores {
  openness: number; conscientiousness: number; extraversion: number;
  agreeableness: number; neuroticism: number;
  communicationStyle: number; decisionMaking: number; brandRelationship: number;
  influenceSusceptibility: number; emotionalExpression: number; conflictBehavior: number;
  literacyArticulation: number; socioeconomicFriction: number;
  identityFusion: number; chronesthesiaCapacity: number;
  tomSelfAwareness: number; tomSocialModeling: number; executiveFlexibility: number;
}

export interface Genome {
  buyerId: string;
  tenantId: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  observationCount: number;
  formationInvariants: string[];
  lastUpdatedAt: string;
  scores: GenomeScores;
}

export interface GenomeMutation {
  traitName: string;
  oldScore: number;
  newScore: number;
  delta: number;
  evidenceSummary: string | null;
  createdAt: string;
}

export interface GenomeResponse {
  genome: Genome;
  mutations: GenomeMutation[];
  dialogCache: Record<string, unknown> | null;
  dialogCacheBuiltAt: string | null;
  osintSummary: string | null;
  hasPersisted: boolean;
}

export const intelligenceApi = {
  getGenome: (buyerId: string) =>
    api.get<GenomeResponse>(`/buyers/${buyerId}/genome`),
  refreshGenome: (buyerId: string) =>
    api.post<GenomeResponse & { updated: boolean; signalsSummary: Record<string, unknown> }>(`/buyers/${buyerId}/genome/refresh`),
};
