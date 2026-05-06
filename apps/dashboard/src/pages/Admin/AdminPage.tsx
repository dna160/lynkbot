import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

interface Tenant {
  id: string;
  storeName: string;
  subscriptionTier: string;
  metaPhoneNumberId: string | null;
  wabaQualityRating: string | null;
  lastMessageAt: string | null;
}

interface DLQStats {
  stats: Record<string, { failed: number; waiting: number; completed: number }>;
}

interface SystemMetrics {
  messagesPerHour: number;
  messagesPerDay: number;
  broadcastsPerDay: number;
  activeFlowExecutions: number;
}

export function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [dlq, setDlq] = useState<DLQStats | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isAdmin = () => {
    const token = localStorage.getItem('lynkbot_token');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.role === 'admin' || payload.role === 'admin_impersonate';
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!isAdmin()) {
      setError('Admin access required');
      setLoading(false);
      return;
    }

    const internalApi = axios.create({
      baseURL: `${BASE_URL}/internal`,
      headers: { 'Content-Type': 'application/json', 'x-api-key': '' },
    });
    internalApi.interceptors.request.use((config) => {
      const token = localStorage.getItem('lynkbot_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    Promise.all([
      internalApi.get('/admin/tenants'),
      internalApi.get('/dlq/stats'),
      internalApi.get('/admin/metrics'),
    ])
      .then(([tRes, dRes, mRes]) => {
        setTenants(tRes.data.tenants ?? []);
        setDlq(dRes.data);
        setMetrics(mRes.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.error || err.message);
        setLoading(false);
      });
  }, []);

  const pauseTenant = async (id: string) => {
    try {
      await api.post(`/admin/tenants/${id}/pause`);
      alert('Tenant flows paused');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const impersonate = async (id: string) => {
    try {
      const res = await api.get(`/admin/tenants/${id}/impersonate`);
      window.open(`/login?token=${encodeURIComponent(res.data.token)}`, '_blank');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const retryQueue = async (queueName: string) => {
    try {
      await api.post('/dlq/retry', { queueName });
      alert(`Retrying ${queueName}`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  if (!isAdmin()) {
    return (
      <div className="p-8 text-white">
        <h1 className="text-2xl font-bold text-red-400">Access Denied</h1>
        <p className="text-slate-400 mt-2">Admin access required.</p>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-white">Loading admin panel...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-white">Admin Superpanel</h1>

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Messages / Hour" value={metrics.messagesPerHour} />
          <MetricCard label="Messages / Day" value={metrics.messagesPerDay} />
          <MetricCard label="Broadcasts / Day" value={metrics.broadcastsPerDay} />
          <MetricCard label="Active Flows" value={metrics.activeFlowExecutions} />
        </div>
      )}

      {/* Tenants */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Tenants</h2>
        <div className="bg-[#1E293B] rounded-xl border border-[#334155] overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-300">
            <thead className="text-xs text-slate-400 uppercase bg-[#0F172A]">
              <tr>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Last Message</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-[#334155]">
                  <td className="px-4 py-3 font-medium">{t.storeName}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs ${tierBadge(t.subscriptionTier)}`}>
                      {t.subscriptionTier}
                    </span>
                  </td>
                  <td className="px-4 py-3">{t.wabaQualityRating ?? '—'}</td>
                  <td className="px-4 py-3">{t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={() => pauseTenant(t.id)} className="text-xs px-2 py-1 bg-red-600/20 text-red-400 rounded hover:bg-red-600/30">Pause</button>
                    <button onClick={() => impersonate(t.id)} className="text-xs px-2 py-1 bg-indigo-600/20 text-indigo-400 rounded hover:bg-indigo-600/30">Impersonate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* DLQ */}
      {dlq && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Dead Letter Queues</h2>
          <div className="bg-[#1E293B] rounded-xl border border-[#334155] overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-300">
              <thead className="text-xs text-slate-400 uppercase bg-[#0F172A]">
                <tr>
                  <th className="px-4 py-3">Queue</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Waiting</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(dlq.stats).map(([name, s]) => (
                  <tr key={name} className="border-b border-[#334155]">
                    <td className="px-4 py-3 font-mono">{name}</td>
                    <td className="px-4 py-3 text-red-400">{s.failed}</td>
                    <td className="px-4 py-3">{s.waiting}</td>
                    <td className="px-4 py-3 text-green-400">{s.completed}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => retryQueue(name)} className="text-xs px-2 py-1 bg-emerald-600/20 text-emerald-400 rounded hover:bg-emerald-600/30">Retry All</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#1E293B] border border-[#334155] rounded-xl p-4">
      <p className="text-xs text-slate-400 uppercase">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value.toLocaleString()}</p>
    </div>
  );
}

function tierBadge(tier: string) {
  switch (tier) {
    case 'trial': return 'bg-slate-600/20 text-slate-400';
    case 'growth': return 'bg-emerald-600/20 text-emerald-400';
    case 'pro': return 'bg-indigo-600/20 text-indigo-400';
    case 'scale': return 'bg-amber-600/20 text-amber-400';
    default: return 'bg-slate-600/20 text-slate-400';
  }
}

import axios from 'axios';
const BASE_URL = window.__LYNKBOT_API_URL__ || import.meta.env.VITE_API_URL || 'http://localhost:3000';
