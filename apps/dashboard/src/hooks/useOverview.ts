import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi, ordersApi, conversationsApi, inventoryApi, productsApi,
  type AnalyticsData, type Order, type Conversation, type InventoryItem, type Product,
} from '@/lib/api';

export interface OverviewData {
  analytics: AnalyticsData;
  recentOrders: Order[];
  recentConversations: Conversation[];
  inventory: InventoryItem[];
  products: Product[];
}

export function useOverview() {
  return useQuery<OverviewData>({
    queryKey: ['overview'],
    queryFn: async () => {
      const [analyticsRes, ordersRes, conversationsRes, inventoryRes, productsRes] =
        await Promise.all([
          analyticsApi.overview(7),
          ordersApi.list({ limit: 5 }),
          conversationsApi.list({ limit: 5, isActive: 'true' }),
          inventoryApi.list(),
          productsApi.list(),
        ]);
      return {
        analytics: analyticsRes.data,
        recentOrders: ordersRes.data.items ?? [],
        recentConversations: conversationsRes.data.items ?? [],
        inventory: inventoryRes.data ?? [],
        products: productsRes.data ?? [],
      };
    },
    staleTime: 30_000,
  });
}

export function usePendingOrdersCount() {
  return useQuery<{ count: number }>({
    queryKey: ['orders', 'pending-count'],
    queryFn: async () => {
      const statuses = ['pending_payment', 'payment_confirmed', 'processing'];
      const results = await Promise.all(statuses.map((s) => ordersApi.list({ status: s, limit: 1 })));
      const count = results.reduce((sum, r) => sum + (r.data.total ?? 0), 0);
      return { count };
    },
    staleTime: 60_000,
  });
}

export function useEscalatedConversationsCount() {
  return useQuery<{ count: number }>({
    queryKey: ['conversations', 'escalated-count'],
    queryFn: async () => {
      const res = await conversationsApi.list({ state: 'ESCALATED', limit: 1 });
      return { count: res.data.total ?? 0 };
    },
    staleTime: 30_000,
    refetchInterval: 10_000,
  });
}

export function useLowStockCount() {
  return useQuery<{ count: number }>({
    queryKey: ['inventory', 'low-stock-count'],
    queryFn: async () => {
      const res = await inventoryApi.list();
      const items: InventoryItem[] = res.data ?? [];
      const count = items.filter((i) => i.quantityAvailable - i.quantityReserved <= i.lowStockThreshold).length;
      return { count };
    },
    staleTime: 60_000,
  });
}
