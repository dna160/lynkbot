import { useState } from 'react';
import { tenantApi } from '../../../lib/api';

export function Step2WhatsApp({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function startOnboarding() {
    setLoading(true); setStatus('testing'); setError('');
    try { await tenantApi.onboard(); setStatus('ok'); }
    catch { setStatus('failed'); setError('Could not start WhatsApp onboarding. Please try again.'); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Connect WhatsApp</h2>
      <p className="text-slate-400 text-sm mb-6">We'll set up your WhatsApp Business account automatically.</p>
      <div className="space-y-4">
        <div className="bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-3">
          <p className="text-slate-300 text-sm">LynkBot uses WATI to power your WhatsApp store. Click <strong>Start Setup</strong> below and our team will handle the rest.</p>
        </div>
        {status !== 'idle' && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${status === 'testing' ? 'bg-slate-700 text-slate-300' : status === 'ok' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
            {status === 'testing' && <span className="animate-pulse">⏳</span>}{status === 'ok' && <span>✓</span>}{status === 'failed' && <span>✗</span>}
            <span>{status === 'testing' ? 'Starting onboarding...' : status === 'ok' ? 'Onboarding initiated!' : 'Failed to start onboarding'}</span>
          </div>
        )}
      </div>
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2 rounded-lg transition-colors">← Back</button>
        <div className="flex gap-3">
          <button onClick={startOnboarding} disabled={loading} className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg transition-colors text-sm">{loading ? 'Starting...' : 'Start Setup'}</button>
          <button onClick={onNext} disabled={status !== 'ok'} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors">Next →</button>
        </div>
      </div>
    </div>
  );
}
