/*
 * @CLAUDE_CONTEXT
 * package: @lynkbot/dashboard
 * file: src/hooks/useAnalytics.ts
 * role: TanStack Query hook for analytics overview by period
 * exports: useAnalytics
 */
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '@/lib/api';

export function useAnalytics(period: '7d' | '30d' | '90d') {
  return useQuery({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => analyticsApi.overview(period).then((r) => r.data),
  });
}
