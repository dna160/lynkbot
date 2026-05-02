/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Flows/FlowsListPage.tsx
 * Role    : Lists automation flows with status badges, risk score banner, and AI generation CTA (PRD §13.1).
 */
import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { flowsApi } from '@/lib/api';
import { RiskScoreGauge } from '@/components/RiskScoreGauge';
import { useToast } from '@/components/ToastProvider';

interface Flow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  triggerType: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  active: 'bg-green-900/40 text-green-400',
  paused: 'bg-yellow-900/40 text-yellow-400',
  archived: 'bg-red-900/40 text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

const TRIGGER_LABEL: Record<string, string> = {
  inbound_keyword: 'Keyword',
  time_based: 'Scheduled',
  order_event: 'Order Event',
  manual: 'Manual',
};

export function FlowsListPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await flowsApi.list({ status: statusFilter || undefined, page, limit: 20 });
      setFlows(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } catch {
      addToast('Failed to load flows', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleActivate = async (id: string) => {
    setActionLoading(id);
    try {
      await flowsApi.updateStatus(id, 'active');
      addToast('Flow activated', 'success');
      load();
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Activation failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePause = async (id: string) => {
    setActionLoading(id);
    try {
      await flowsApi.updateStatus(id, 'paused');
      addToast('Flow paused', 'success');
      load();
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Pause failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Archive flow "${name}"?`)) return;
    setActionLoading(id);
    try {
      await flowsApi.updateStatus(id, 'archived');
      addToast('Flow archived', 'success');
      load();
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Archive failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleTest = async (id: string) => {
    setActionLoading(id);
    try {
      await flowsApi.test(id);
      addToast('Test execution triggered', 'success');
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Test failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Flows</h1>
          <p className="text-sm text-secondary mt-0.5">{total} flow{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard/flows/new')}
            className="flex items-center gap-2 px-4 py-2 bg-accent/20 text-accent border border-accent/40 rounded-lg text-sm font-medium hover:bg-accent/30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Generate with AI
          </button>
          <button
            onClick={() => navigate('/dashboard/flows/new')}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Flow
          </button>
        </div>
      </div>

      {/* Sender Risk Score */}
      <RiskScoreGauge />

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_LABEL).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : flows.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-secondary/40 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-secondary font-medium">No flows yet</p>
            <p className="text-secondary/60 text-sm mt-1">Generate with AI or build manually</p>
            <button
              onClick={() => navigate('/dashboard/flows/new')}
              className="mt-4 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
            >
              Create Flow
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-secondary font-medium">Name</th>
                <th className="text-left px-4 py-3 text-secondary font-medium">Status</th>
                <th className="text-left px-4 py-3 text-secondary font-medium">Trigger</th>
                <th className="text-left px-4 py-3 text-secondary font-medium">Created</th>
                <th className="text-right px-4 py-3 text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {flows.map(flow => (
                <tr key={flow.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-primary">{flow.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[flow.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {STATUS_LABEL[flow.status] ?? flow.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-secondary">
                    {TRIGGER_LABEL[flow.triggerType] ?? flow.triggerType ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-secondary">
                    {new Date(flow.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {(flow.status === 'draft' || flow.status === 'paused') && (
                        <Link
                          to={`/dashboard/flows/${flow.id}/edit`}
                          className="text-xs text-accent hover:underline"
                        >
                          Edit
                        </Link>
                      )}
                      {flow.status === 'draft' && (
                        <button
                          onClick={() => handleActivate(flow.id)}
                          disabled={actionLoading === flow.id}
                          className="text-xs text-green-400 hover:underline disabled:opacity-40"
                        >
                          Activate
                        </button>
                      )}
                      {flow.status === 'active' && (
                        <button
                          onClick={() => handlePause(flow.id)}
                          disabled={actionLoading === flow.id}
                          className="text-xs text-yellow-400 hover:underline disabled:opacity-40"
                        >
                          Pause
                        </button>
                      )}
                      {(flow.status === 'draft' || flow.status === 'paused') && (
                        <button
                          onClick={() => handleTest(flow.id)}
                          disabled={actionLoading === flow.id}
                          className="text-xs text-secondary hover:text-primary hover:underline disabled:opacity-40"
                        >
                          Test
                        </button>
                      )}
                      {flow.status !== 'archived' && (
                        <button
                          onClick={() => handleArchive(flow.id, flow.name)}
                          disabled={actionLoading === flow.id}
                          className="text-xs text-red-400 hover:underline disabled:opacity-40"
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-border rounded-lg text-secondary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-secondary">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border border-border rounded-lg text-secondary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
