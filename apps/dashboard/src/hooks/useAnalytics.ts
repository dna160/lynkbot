import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type AnalyticsData } from '@/lib/api';

const PERIOD_TO_DAYS: Record<'7d' | '30d' | '90d', number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function useAnalytics(period: '7d' | '30d' | '90d' = '30d') {
  return useQuery<AnalyticsData>({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => analyticsApi.overview(PERIOD_TO_DAYS[period]).then((r) => r.data),
    staleTime: 60_000,
  });
}
