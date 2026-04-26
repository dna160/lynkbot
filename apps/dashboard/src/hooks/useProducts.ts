import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi, inventoryApi, type CreateProductPayload, type Product } from '@/lib/api';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list().then((r) => r.data),
  });
}

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.list().then((r) => r.data),
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProductPayload) => productsApi.create(data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Product> }) =>
      productsApi.update(id, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUpdateInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, data }: { productId: string; data: { quantityAvailable: number; lowStockThreshold: number } }) =>
      inventoryApi.update(productId, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
