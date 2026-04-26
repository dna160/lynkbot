import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '@/lib/api';

export function useOrders(params?: { status?: string; page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () => ordersApi.list(params).then((r) => r.data),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () => ordersApi.get(id).then((r) => r.data),
    enabled: !!id,
  });
}

export function useUpdateResi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resiNumber, courierCode }: { id: string; resiNumber: string; courierCode: string }) =>
      ordersApi.updateResi(id, resiNumber, courierCode).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
