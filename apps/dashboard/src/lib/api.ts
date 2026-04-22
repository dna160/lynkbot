/*
 * @CLAUDE_CONTEXT
 * package: @lynkbot/dashboard
 * file: src/lib/api.ts
 * role: Typed Axios client with Bearer token interceptor and all API endpoint helpers
 * exports: api (AxiosInstance), authApi, tenantApi, productsApi, ordersApi, conversationsApi, analyticsApi
 */
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lynkbot_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
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
  }
);

// ─── Types ───────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type ConvState =
  | 'INIT'
  | 'GREETING'
  | 'BROWSING'
  | 'PRODUCT_INQUIRY'
  | 'OBJECTION_HANDLING'
  | 'CHECKOUT_INTENT'
  | 'ADDRESS_COLLECTION'
  | 'SHIPPING_CALC'
  | 'PAYMENT_METHOD_SELECT'
  | 'INVOICE_GENERATION'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_CONFIRMED'
  | 'PROCESSING_ORDER'
  | 'FULFILMENT'
  | 'POST_PURCHASE'
  | 'REVIEW_REQUEST'
  | 'OUT_OF_STOCK'
  | 'WAITLIST_ENROLLED'
  | 'ESCALATED'
  | 'HARD_STOP'
  | 'CLOSED_WON'
  | 'CLOSED_LOST';

export interface Tenant {
  id: string;
  storeName: string;
  originCityName?: string;
  watiApiKey?: string;
  onboardingCompleted: boolean;
  onboardingStep?: number;
  paymentProviders?: { provider: string; accountId: string }[];
  createdAt: string;
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
  productId?: string;
  messageCount: number;
  lastMessageAt: string;
  buyer?: { waPhone: string; displayName?: string };
}

export interface AnalyticsOverview {
  totalOrders: number;
  totalRevenue: number;
  conversionRate: number;
  avgOrderValue: number;
  ordersByStatus: Record<OrderStatus, number>;
  revenueOverTime: { date: string; revenue: number }[];
  topProducts: { productId: string; name: string; unitsSold: number; revenue: number }[];
  funnelData: { stage: string; count: number }[];
}

export interface CreateProductPayload {
  name: string;
  sku?: string;
  description?: string;
  priceIdr: number;
  weightGrams: number;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, _password: string) =>
    api.post<{ token: string; user: { id: string; email: string; tenantId: string } }>(
      '/auth/login',
      { lynkUserId: email }
    ),
};

// ─── Tenant ──────────────────────────────────────────────────────────────────

export const tenantApi = {
  getMe: () => api.get<Tenant>('/tenants/me'),
  updateMe: (data: Partial<Tenant>) => api.put<Tenant>('/tenants/me', data),
  onboarding: (step: number, data: Record<string, unknown>) =>
    api.post('/tenants/me/onboarding', { step, data }),
};

// ─── Products ────────────────────────────────────────────────────────────────

export const productsApi = {
  list: () => api.get<Product[]>('/products'),
  get: (id: string) => api.get<Product>(`/products/${id}`),
  create: (data: CreateProductPayload) => api.post<Product>('/products', data),
  update: (id: string, data: Partial<Product>) => api.put<Product>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
};

export const inventoryApi = {
  list: () => api.get<InventoryItem[]>('/inventory'),
  update: (
    productId: string,
    data: { quantity_available: number; low_stock_threshold: number }
  ) => api.put<InventoryItem>(`/inventory/${productId}`, data),
};

// ─── Orders ──────────────────────────────────────────────────────────────────

export const ordersApi = {
  list: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get<{ items: Order[]; total: number }>('/orders', { params }),
  get: (id: string) => api.get<Order>(`/orders/${id}`),
  updateResi: (id: string, resiNumber: string, courierCode: string) =>
    api.put<Order>(`/orders/${id}/resi`, { resi_number: resiNumber, courier_code: courierCode }),
};

// ─── Conversations ───────────────────────────────────────────────────────────

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

export const conversationsApi = {
  list: (params?: { state?: string; isActive?: string; page?: number; limit?: number }) =>
    api.get<{ items: Conversation[]; total: number }>('/conversations', { params }),
  get: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
  sendMessage: (id: string, text: string) =>
    api.post<Message>(`/conversations/${id}/send-message`, { text }),
  takeover: (id: string) => api.post(`/conversations/${id}/takeover`),
  returnToBot: (id: string) => api.post(`/conversations/${id}/return-to-bot`),
};

// ─── Analytics ───────────────────────────────────────────────────────────────

export const analyticsApi = {
  overview: (period: '7d' | '30d' | '90d') =>
    api.get<AnalyticsOverview>('/analytics/overview', { params: { period } }),
};

// ─── Buyers ──────────────────────────────────────────────────────────────────

export interface Buyer {
  id: string;
  tenantId: string;
  waPhone: string;
  displayName?: string;
  preferredLanguage?: string;
  tags?: string[];
  notes?: string;
  doNotContact: boolean;
  totalOrders: number;
  totalSpendIdr: number;
  createdAt: string;
  updatedAt: string;
}

export const buyersApi = {
  list: (params?: { search?: string; page?: number; limit?: number; tag?: string }) =>
    api.get<{ items: Buyer[]; total: number; page: number; limit: number }>('/buyers', { params }),
  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ imported: number; skipped: number; total: number; errors: string[] }>(
      '/buyers/import',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
  update: (id: string, data: { displayName?: string; notes?: string; tags?: string[]; doNotContact?: boolean }) =>
    api.patch<Buyer>(`/buyers/${id}`, data),
  delete: (id: string) => api.delete(`/buyers/${id}`),
};

// ─── Broadcasts ──────────────────────────────────────────────────────────────

export interface BroadcastTemplate {
  key: string;
  name: string;
  params: string[];
}

export interface Broadcast {
  id: string;
  tenantId: string;
  templateName: string;
  templateParams: string[];
  audienceFilter?: { tags?: string[] } | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: 'pending' | 'sending' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string | null;
}

// ─── AI ──────────────────────────────────────────────────────────────────────

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
    api.post<{ reply: string; _meta?: { modelId: string; tokensUsed: number; latencyMs: number } }>('/ai/chat', { message, context }),
  suggestReply: (data: { messages: { role: 'user' | 'assistant'; content: string }[]; context?: string }) =>
    api.post<{ reply: string; _meta?: { modelId: string; tokensUsed: number; latencyMs: number } }>('/ai/chat', {
      message: 'Suggest a helpful reply for the conversation operator based on the chat history.',
      context: JSON.stringify(data),
    }),
};

export const broadcastsApi = {
  templates: () => api.get<{ templates: BroadcastTemplate[] }>('/broadcasts/templates'),
  list: (params?: { page?: number; limit?: number }) =>
    api.get<{ items: Broadcast[]; page: number; limit: number }>('/broadcasts', { params }),
  create: (data: { templateKey: string; parameters: string[]; audienceFilter?: { tags?: string[] } }) =>
    api.post<{ id: string; recipientCount: number; status: string; message: string }>('/broadcasts', data),
  get: (id: string) => api.get<Broadcast>(`/broadcasts/${id}`),
};
