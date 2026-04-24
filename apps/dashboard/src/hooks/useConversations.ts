/*
 * @CLAUDE_CONTEXT
 * package: @lynkbot/dashboard
 * file: src/hooks/useConversations.ts
 * role: TanStack Query hooks for conversations with 5s polling, takeover, return-to-bot
 * exports: useConversations, useTakeover, useReturnToBot
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { conversationsApi } from '@/lib/api';

export function useConversations(params?: { state?: string; isActive?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['conversations', params],
    queryFn: () => conversationsApi.list(params).then((r) => r.data),
    refetchInterval: 5_000,
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
