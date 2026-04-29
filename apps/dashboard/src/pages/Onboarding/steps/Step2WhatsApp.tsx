import { useState } from 'react';
import { api } from '../../../lib/api';

type Mode = 'choose' | 'pool' | 'manual';
type Status = 'idle' | 'loading' | 'ok' | 'failed';

export function Step2WhatsApp({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('choose');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [displayPhone, setDisplayPhone] = useState('');

  // Manual mode fields
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  async function connectPool() {
    setStatus('loading'); setError('');
    try {
      const res = await api.post('/onboarding/complete', { mode: 'pool' });
      setDisplayPhone(res.data.displayPhone ?? '');
      setStatus('ok');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not assign a WhatsApp number. Our team has been notified.');
      setStatus('failed');
    }
  }

  async function connectManual() {
    if (!phoneNumberId || !wabaId || !accessToken) {
      setError('All three fields are required.');
      return;
    }
    setStatus('loading'); setError('');
    try {
      const res = await api.post('/onboarding/complete', { mode: 'manual', metaPhoneNumberId: phoneNumberId, wabaId, metaAccessToken: accessToken });
      setDisplayPhone(res.data.displayPhone ?? phoneNumberId);
      setStatus('ok');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not verify your Meta credentials.');
      setStatus('failed');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Connect WhatsApp</h2>
      <p className="text-slate-400 text-sm mb-6">Choose how to link your WhatsApp Business account.</p>

      {mode === 'choose' && (
        <div className="space-y-3">
          <button
            onClick={() => setMode('pool')}
            className="w-full text-left bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 rounded-xl px-5 py-4 transition-colors"
          >
            <p className="text-white font-medium">Use LynkBot Number</p>
            <p className="text-slate-400 text-sm mt-1">We'll assign you a pre-verified WhatsApp number — fastest way to get started.</p>
          </button>
          <button
            onClick={() => setMode('manual')}
            className="w-full text-left bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600 rounded-xl px-5 py-4 transition-colors"
          >
            <p className="text-white font-medium">Bring Your Own WABA</p>
            <p className="text-slate-400 text-sm mt-1">Already have a Meta-verified WABA? Enter your credentials below.</p>
          </button>
        </div>
      )}

      {mode === 'pool' && status !== 'ok' && (
        <div className="space-y-4">
          <div className="bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-3">
            <p className="text-slate-300 text-sm">LynkBot will assign you a pre-verified WhatsApp Business number. Click <strong>Activate</strong> to continue.</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => setMode('choose')} className="text-slate-400 hover:text-white text-sm">← Back</button>
            <button
              onClick={connectPool}
              disabled={status === 'loading'}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-sm"
            >
              {status === 'loading' ? 'Activating...' : 'Activate'}
            </button>
          </div>
        </div>
      )}

      {mode === 'manual' && status !== 'ok' && (
        <div className="space-y-4">
          <p className="text-slate-400 text-xs">Find these values in <strong>Meta Business Manager → WhatsApp → API Setup</strong>.</p>
          <div>
            <label className="block text-slate-300 text-sm mb-1">Phone Number ID</label>
            <input value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="1234567890" className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-slate-300 text-sm mb-1">WABA ID</label>
            <input value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="1234567890" className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-slate-300 text-sm mb-1">System User Access Token</label>
            <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAAx..." className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => setMode('choose')} className="text-slate-400 hover:text-white text-sm">← Back</button>
            <button
              onClick={connectManual}
              disabled={status === 'loading'}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-sm"
            >
              {status === 'loading' ? 'Verifying...' : 'Verify & Connect'}
            </button>
          </div>
        </div>
      )}

      {status === 'ok' && (
        <div className="bg-green-900/30 border border-green-700/40 rounded-lg px-4 py-4 text-green-400 text-sm">
          ✓ WhatsApp connected — <strong>{displayPhone}</strong>
        </div>
      )}

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2 rounded-lg transition-colors">← Back</button>
        <button onClick={onNext} disabled={status !== 'ok'} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}
