/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Onboarding/steps/Step2WhatsApp.tsx
 * Role    : WATI API key input + connection test. POSTs to onboarding step 2.
 */
import { useState } from 'react';
import { api } from '../../../lib/api';

interface Props { onNext: () => void; onBack: () => void; }

type ConnStatus = 'idle' | 'testing' | 'ok' | 'failed';

export function Step2WhatsApp({ onNext, onBack }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<ConnStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function testAndSave() {
    if (!apiKey.trim()) { setError('API key is required.'); return; }
    setLoading(true);
    setStatus('testing');
    setError('');
    try {
      await api.post('/tenants/me/onboarding', { step: 2, data: { watiApiKey: apiKey.trim() } });
      setStatus('ok');
    } catch {
      setStatus('failed');
      setError('Could not verify the API key. Check it and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Connect WhatsApp (WATI)</h2>
      <p className="text-slate-400 text-sm mb-6">
        Get your API key from{' '}
        <span className="text-indigo-400">app.wati.io → Settings → API</span>.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-300 mb-1">WATI API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setStatus('idle'); }}
            placeholder="eyJhbGciOiJIUzI1NiIs..."
            className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-sm"
          />
        </div>

        {status !== 'idle' && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
            status === 'testing' ? 'bg-slate-700 text-slate-300' :
            status === 'ok' ? 'bg-green-900/40 text-green-400' :
            'bg-red-900/40 text-red-400'
          }`}>
            {status === 'testing' && <span className="animate-pulse">⏳</span>}
            {status === 'ok' && <span>✓</span>}
            {status === 'failed' && <span>✗</span>}
            <span>
              {status === 'testing' ? 'Connecting...' :
               status === 'ok' ? 'Connected successfully!' :
               'Connection failed'}
            </span>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
          ← Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={testAndSave}
            disabled={loading}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            onClick={onNext}
            disabled={status !== 'ok'}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
