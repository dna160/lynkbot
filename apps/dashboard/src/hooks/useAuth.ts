import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, tenantApi, getTenantIdFromToken } from '@/lib/api';

export function useAuth() {
  const qc = useQueryClient();

  const tenantQuery = useQuery({
    queryKey: ['tenant', 'me'],
    queryFn: () => tenantApi.getMe().then((r) => r.data),
    enabled: !!getTenantIdFromToken(),
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password).then((r) => r.data),
    onSuccess: (data) => {
      localStorage.setItem('lynkbot_token', data.token);
      qc.invalidateQueries({ queryKey: ['tenant', 'me'] });
    },
  });

  const logout = () => {
    localStorage.removeItem('lynkbot_token');
    qc.clear();
    window.location.href = '/login';
  };

  return {
    tenant: tenantQuery.data,
    tenantLoading: tenantQuery.isLoading,
    tenantError: tenantQuery.error,
    login: loginMutation.mutateAsync,
    loginPending: loginMutation.isPending,
    loginError: loginMutation.error,
    logout,
    isAuthenticated: !!getTenantIdFromToken(),
  };
}
