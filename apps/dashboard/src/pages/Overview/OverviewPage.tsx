/**
 * Package : apps/dashboard
 * File    : src/pages/Overview/OverviewPage.tsx
 * Role    : Dashboard overview home — KPIs, recent activity, quick actions
 * Exports : OverviewPage
 */
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';
import { useOverview } from '@/hooks/useOverview';
import { QuickActionCard } from '@/components/QuickActionCard';
import { Badge } from '@/components/Badge';
import { conversationsApi } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

function fmtIdr(n: number, short = false): string {
  if (short && n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (short && n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return d.toLocaleDateString('id-ID', { month: 'short', day: 'numeric' });
}

function timeAgo(s: string): string {
  const secs = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

const ORDER_STATUS_STYLE: Record<string, string> = {
  pending_payment: 'bg-yellow-600/20 text-yellow-400',
  paid: 'bg-blue-600/20 text-blue-400',
  processing: 'bg-purple-600/20 text-purple-400',
  shipped: 'bg-indigo-600/20 text-indigo-400',
  delivered: 'bg-green-600/20 text-green-400',
  cancelled: 'bg-red-600/20 text-red-400',
  refunded: 'bg-slate-600/20 text-slate-400',
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function OverviewPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useOverview();

  const analytics = data?.analytics;
  const recentOrders = data?.recentOrders ?? [];
  const recentConversations = data?.recentConversations ?? [];
  const inventory = data?.inventory ?? [];

  const lowStockCount = inventory.filter(
    (i) => i.quantityAvailable - i.quantityReserved <= i.lowStockThreshold
  ).length;

  const totalOrders = analytics?.totalOrders ?? 0;
  const totalRevenue = analytics?.totalRevenue ?? 0;

  const statusData = analytics
    ? Object.entries(analytics.ordersByStatus)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name: ORDER_STATUS_LABEL[name] ?? name, value }))
    : [];

  const takeover = useMutation({
    mutationFn: (id: string) => conversationsApi.takeover(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      addToast('Conversation taken over', 'success');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="text-slate-400 text-sm mt-1">Your store at a glance</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2">
            <span className="text-sm text-secondary">Total Orders (7d)</span>
            <div className="text-2xl font-bold text-primary">{totalOrders.toLocaleString('id-ID')}</div>
            <div className="text-xs text-secondary">From analytics period</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2">
            <span className="text-sm text-secondary">Revenue (7d)</span>
            <div className="text-2xl font-bold text-primary">{fmtIdr(totalRevenue, true)}</div>
            <div className="text-xs text-secondary">{analytics ? `${analytics.conversionRate.toFixed(1)}% conv.` : ''}</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2">
            <span className="text-sm text-secondary">Avg. Order Value</span>
            <div className="text-2xl font-bold text-primary">{fmtIdr(analytics?.avgOrderValue ?? 0, true)}</div>
            <div className="text-xs text-secondary">Per transaction</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2">
            <span className="text-sm text-secondary">Low Stock Alerts</span>
            <div className="text-2xl font-bold text-primary">{lowStockCount}</div>
            <div className="text-xs text-secondary">Products need attention</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300">Quick Actions</h2>
          <QuickActionCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            }
            label="Add Product"
            description="Create a new product listing"
            onClick={() => navigate('/dashboard/products')}
            color="indigo"
          />
          <QuickActionCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            }
            label="Send Broadcast"
            description="Message your contacts"
            onClick={() => navigate('/dashboard/buyers')}
            color="violet"
          />
          <QuickActionCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            label="View Orders"
            description="Manage pending orders"
            onClick={() => navigate('/dashboard/orders')}
            color="blue"
          />
          <QuickActionCard
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
            label="Full Analytics"
            description="Detailed reports and charts"
            onClick={() => navigate('/dashboard/analytics')}
            color="green"
          />
        </div>

        <div className="col-span-2 bg-surface border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Revenue (Last 7 Days)</h2>
          {isLoading ? (
            <div className="h-48 bg-white/5 rounded-lg animate-pulse" />
          ) : analytics?.revenueOverTime.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No revenue data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={analytics?.revenueOverTime} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94A3B8', fontSize: 11 }} />
                <YAxis tickFormatter={(n) => fmtIdr(n, true)} tick={{ fill: '#94A3B8', fontSize: 11 }} width={70} />
                <Tooltip
                  contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#94A3B8' }}
                  formatter={(v: number) => [fmtIdr(v), 'Revenue']}
                  labelFormatter={(l: string) => fmtDate(l)}
                />
                <Line type="monotone" dataKey="revenue" stroke="#6366F1" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">Recent Orders</h2>
            <button onClick={() => navigate('/dashboard/orders')} className="text-xs text-accent hover:text-indigo-300 transition-colors">
              View all &rarr;
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">No orders yet.</div>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => navigate('/dashboard/orders')}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-indigo-400">{order.orderCode}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ORDER_STATUS_STYLE[order.status] ?? ''}`}>
                        {ORDER_STATUS_LABEL[order.status] ?? order.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {order.buyer?.displayName || order.buyer?.waPhone || 'Unknown'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-medium text-white">{fmtIdr(order.totalAmountIdr)}</div>
                    <div className="text-[10px] text-slate-500">{fmtDate(order.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">Live Conversations</h2>
            <button onClick={() => navigate('/dashboard/conversations')} className="text-xs text-accent hover:text-indigo-300 transition-colors">
              View all &rarr;
            </button>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentConversations.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">No active conversations.</div>
          ) : (
            <div className="space-y-2">
              {recentConversations.map((conv) => {
                const isEscalated = conv.state === 'ESCALATED';
                return (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white truncate">
                          {conv.buyer?.displayName || conv.buyer?.waPhone || 'Unknown'}
                        </span>
                        {isEscalated && (
                          <Badge variant="red" pulse>Human</Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {conv.state.replace(/_/g, ' ')} &middot; {conv.messageCount} msgs
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-slate-500">{timeAgo(conv.lastMessageAt)}</span>
                      {!isEscalated && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            takeover.mutate(conv.id);
                          }}
                          disabled={takeover.isPending}
                          className="text-[10px] px-2 py-1 rounded bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 transition-colors disabled:opacity-50"
                        >
                          Take Over
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Orders by Status</h2>
        {isLoading ? (
          <div className="h-32 bg-white/5 rounded-lg animate-pulse" />
        ) : statusData.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">No order data available.</div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={statusData} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
              <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94A3B8' }} />
              <Bar dataKey="value" fill="#6366F1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
