/*
 * @CLAUDE_CONTEXT
 * package: @lynkbot/dashboard
 * file: src/lib/queryClient.ts
 * role: TanStack Query v5 client instance with sensible defaults
 * exports: queryClient
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
