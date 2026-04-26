import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '@/lib/api';

export function useConversations(params?: { state?: string; isActive?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['conversations', params],
    queryFn: () => conversationsApi.list(params).then((r) => r.data),
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => conversationsApi.get(id).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      conversationsApi.sendMessage(id, text).then((r) => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['conversation', vars.id] });
    },
  });
}

export function useTakeover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationsApi.takeover(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useReturnToBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationsApi.returnToBot(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
