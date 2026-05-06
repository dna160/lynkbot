import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

interface ConsentRecord {
  id: string;
  tenantId: string;
  waId: string;
  action: 'opt_in' | 'opt_out';
  channel: string;
  timestamp: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface PrivacyConfig {
  privacyNoticeText: string;
  contactInfo: string;
  optOutKeyword: string;
  retentionDays: number;
}

export function CompliancePage() {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [config, setConfig] = useState<PrivacyConfig>({
    privacyNoticeText: 'Your privacy is important. Reply STOP to opt out.',
    contactInfo: 'support@example.com',
    optOutKeyword: 'STOP',
    retentionDays: 365,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadConsents();
    loadConfig();
  }, []);

  const loadConsents = async () => {
    try {
      const res = await api.get('/compliance/consents', { params: { limit: 100, search } });
      setConsents(res.data.consents ?? []);
    } catch (err: any) {
      console.error('Failed to load consents:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    try {
      const res = await api.get('/compliance/config');
      setConfig(res.data);
    } catch (err: any) {
      // fallback to defaults
    }
  };

  const exportCSV = async () => {
    try {
      const res = await api.get('/compliance/consents/export', { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `consent-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Export failed');
    }
  };

  const saveConfig = async () => {
    try {
      await api.post('/compliance/config', config);
      alert('Privacy configuration saved');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  if (loading) return <div className="p-8 text-white">Loading compliance data...</div>;

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-white">Compliance Dashboard</h1>

      {/* Privacy Configuration */}
      <section className="bg-[#1E293B] rounded-xl border border-[#334155] p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Privacy Notice Configuration</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 uppercase">Privacy Notice Text</label>
            <textarea
              className="w-full mt-1 p-2 bg-[#0F172A] border border-[#334155] rounded text-white text-sm"
              rows={3}
              value={config.privacyNoticeText}
              onChange={(e) => setConfig({ ...config, privacyNoticeText: e.target.value })}
            />
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 uppercase">Contact Info</label>
              <input
                type="text"
                className="w-full mt-1 p-2 bg-[#0F172A] border border-[#334155] rounded text-white text-sm"
                value={config.contactInfo}
                onChange={(e) => setConfig({ ...config, contactInfo: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase">Opt-Out Keyword</label>
              <input
                type="text"
                className="w-full mt-1 p-2 bg-[#0F172A] border border-[#334155] rounded text-white text-sm"
                value={config.optOutKeyword}
                onChange={(e) => setConfig({ ...config, optOutKeyword: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase">Retention Days</label>
              <input
                type="number"
                className="w-full mt-1 p-2 bg-[#0F172A] border border-[#334155] rounded text-white text-sm"
                value={config.retentionDays}
                onChange={(e) => setConfig({ ...config, retentionDays: parseInt(e.target.value) || 365 })}
              />
            </div>
          </div>
        </div>
        <button
          onClick={saveConfig}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-500"
        >
          Save Configuration
        </button>
      </section>

      {/* Consent Audit Log */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Consent Audit Log</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search WA ID..."
              className="px-3 py-1 bg-[#0F172A] border border-[#334155] rounded text-white text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadConsents()}
            />
            <button onClick={loadConsents} className="px-3 py-1 bg-slate-700 text-white rounded text-sm hover:bg-slate-600">Search</button>
            <button onClick={exportCSV} className="px-3 py-1 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded text-sm hover:bg-emerald-600/30">Export CSV</button>
          </div>
        </div>
        <div className="bg-[#1E293B] rounded-xl border border-[#334155] overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-300">
            <thead className="text-xs text-slate-400 uppercase bg-[#0F172A]">
              <tr>
                <th className="px-4 py-3">WA ID</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((c) => (
                <tr key={c.id} className="border-b border-[#334155]">
                  <td className="px-4 py-3 font-mono">{c.waId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs ${c.action === 'opt_in' ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                      {c.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.channel}</td>
                  <td className="px-4 py-3">{new Date(c.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.ipAddress ?? '—'}</td>
                </tr>
              ))}
              {consents.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No consent records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
