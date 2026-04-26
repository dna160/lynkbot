import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { useAnalytics } from '@/hooks/useAnalytics';
import { StatCard } from '@/components/StatCard';

type Period = '7d' | '30d' | '90d';
const PERIOD_LABELS: Record<Period, string> = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' };

function fmtIdr(n: number, short = false): string {
  if (short && n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (short && n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}
function fmtDate(s: string): string { return new Date(s).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' }); }

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const { data, isLoading, error } = useAnalytics(period);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-slate-400 text-sm mt-1">Store performance overview</p>
        </div>
        <div className="flex gap-1 bg-[#1E293B] border border-[#334155] rounded-lg p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${period === p ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>{PERIOD_LABELS[p]}</button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 bg-red-900/20 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">Failed to load analytics: {(error as Error).message}</div>}

      {isLoading ? <div className="grid grid-cols-4 gap-4 mb-6">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-[#1E293B] rounded-xl animate-pulse" />)}</div> : data ? (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Orders" value={String(data.totalOrders)} />
            <StatCard label="Total Revenue" value={fmtIdr(data.totalRevenue, true)} />
            <StatCard label="Conversion Rate" value={`${data.conversionRate.toFixed(1)}%`} />
            <StatCard label="Avg. Order Value" value={fmtIdr(data.avgOrderValue, true)} />
          </div>

          <div className="bg-[#1E293B] border border-[#334155] rounded-xl p-5 mb-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-4">Revenue Over Time</h2>
            {data.revenueOverTime.length === 0 ? <div className="h-52 flex items-center justify-center text-slate-500 text-sm">No data for this period.</div> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.revenueOverTime} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis tickFormatter={(n) => fmtIdr(n, true)} tick={{ fill: '#94A3B8', fontSize: 11 }} width={70} />
                  <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94A3B8' }} formatter={(v: number) => [fmtIdr(v), 'Revenue']} labelFormatter={(l: string) => fmtDate(l)} />
                  <Line type="monotone" dataKey="revenue" stroke="#6366F1" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-[#1E293B] border border-[#334155] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-4">Conversation Funnel</h2>
              {data.funnelData.length === 0 ? <div className="h-52 flex items-center justify-center text-slate-500 text-sm">No data.</div> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.funnelData} layout="vertical" margin={{ top: 5, right: 20, left: 110, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <YAxis type="category" dataKey="stage" tick={{ fill: '#94A3B8', fontSize: 11 }} width={105} />
                    <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94A3B8' }} />
                    <Bar dataKey="count" fill="#6366F1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-[#1E293B] border border-[#334155] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-4">Top Products</h2>
              {data.topProducts.length === 0 ? <div className="text-slate-500 text-sm text-center py-8">No sales yet.</div> : (
                <div className="space-y-3">
                  {data.topProducts.slice(0, 5).map((p, i) => (
                    <div key={p.productId} className="flex items-center gap-3">
                      <span className="text-slate-500 text-sm w-4 flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{p.name}</p>
                        <p className="text-slate-400 text-xs">{p.unitsSold} sold · {fmtIdr(p.revenue, true)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
