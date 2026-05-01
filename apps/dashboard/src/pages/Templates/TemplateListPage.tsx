import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { flowTemplatesApi } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

interface FlowTemplate {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  bodyText: string;
  appealCount: number;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  pending_submission: 'bg-yellow-900/40 text-yellow-400',
  submitted: 'bg-yellow-900/40 text-yellow-400',
  pending_review: 'bg-yellow-900/40 text-yellow-400',
  approved: 'bg-green-900/40 text-green-400',
  rejected: 'bg-red-900/40 text-red-400',
  paused: 'bg-slate-700 text-slate-300',
  disabled: 'bg-red-900/40 text-red-400 line-through',
  flagged: 'bg-orange-900/40 text-orange-400',
  in_appeal: 'bg-purple-900/40 text-purple-400',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_submission: 'Pending',
  submitted: 'Submitted',
  pending_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  paused: 'Paused',
  disabled: 'Disabled',
  flagged: 'Flagged',
  in_appeal: 'In Appeal',
};

export function TemplateListPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await flowTemplatesApi.list({
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
        page,
        limit: 20,
      });
      setTemplates(res.data.items);
      setTotal(res.data.total);
    } catch {
      addToast('Failed to load templates', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, page, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (id: string) => {
    setActionLoading(id);
    try {
      await flowTemplatesApi.submit(id);
      addToast('Template submitted for review', 'success');
      load();
    } catch (err: any) {
      const msg: string = err?.response?.data?.error ?? '';
      if (msg.includes('no WABA ID') || msg.includes('no Meta access token')) {
        addToast('WhatsApp not connected — go to Settings → WhatsApp to add your WABA credentials', 'error');
      } else if (msg.includes('WABA_POOL_ENCRYPTION_KEY')) {
        addToast('Server config missing — set WABA_POOL_ENCRYPTION_KEY in Railway env vars', 'error');
      } else {
        addToast(msg || 'Submission failed', 'error');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handlePause = async (id: string) => {
    setActionLoading(id);
    try {
      await flowTemplatesApi.pause(id);
      addToast('Template paused', 'success');
      load();
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Pause failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setActionLoading(id);
    try {
      await flowTemplatesApi.delete(id);
      addToast('Template deleted', 'success');
      load();
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Delete failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">Templates</h1>
          <p className="text-sm text-secondary mt-0.5">{total} template{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => navigate('/dashboard/templates/new')}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
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
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="bg-surface border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
        >
          <option value="">All categories</option>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utility</option>
          <option value="AUTHENTICATION">Authentication</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-secondary/40 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-secondary font-medium">No templates yet</p>
            <p className="text-secondary/60 text-sm mt-1">Create your first WhatsApp message template</p>
            <button
              onClick={() => navigate('/dashboard/templates/new')}
              className="mt-4 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 transition-colors"
            >
              Create Template
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-secondary font-medium">Name</th>
                <th className="text-left px-4 py-3 text-secondary font-medium">Status</th>
                <th className="text-left px-4 py-3 text-secondary font-medium">Category</th>
                <th className="text-left px-4 py-3 text-secondary font-medium">Language</th>
                <th className="text-right px-4 py-3 text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.map(tmpl => (
                <tr key={tmpl.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-mono text-primary text-xs">{tmpl.name}</div>
                    <div className="text-secondary/60 text-xs mt-0.5 line-clamp-1">{tmpl.bodyText}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[tmpl.status] ?? 'bg-slate-700 text-slate-300'}`}>
                      {STATUS_LABEL[tmpl.status] ?? tmpl.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-secondary capitalize">{tmpl.category.toLowerCase()}</td>
                  <td className="px-4 py-3 text-secondary uppercase">{tmpl.language}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {(tmpl.status === 'draft' || tmpl.status === 'rejected') && (
                        <Link
                          to={`/dashboard/templates/${tmpl.id}/edit`}
                          className="text-xs text-accent hover:underline"
                        >
                          Edit
                        </Link>
                      )}
                      {tmpl.status === 'draft' && (
                        <button
                          onClick={() => handleSubmit(tmpl.id)}
                          disabled={actionLoading === tmpl.id}
                          className="text-xs text-green-400 hover:underline disabled:opacity-40"
                        >
                          Submit
                        </button>
                      )}
                      {tmpl.status === 'approved' && (
                        <button
                          onClick={() => handlePause(tmpl.id)}
                          disabled={actionLoading === tmpl.id}
                          className="text-xs text-yellow-400 hover:underline disabled:opacity-40"
                        >
                          Pause
                        </button>
                      )}
                      {tmpl.status === 'draft' && (
                        <button
                          onClick={() => handleDelete(tmpl.id, tmpl.name)}
                          disabled={actionLoading === tmpl.id}
                          className="text-xs text-red-400 hover:underline disabled:opacity-40"
                        >
                          Delete
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
        <div className="flex items-center justify-end gap-3 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-border rounded-lg text-secondary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-secondary">
            Page {page} of {totalPages}
          </span>
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
