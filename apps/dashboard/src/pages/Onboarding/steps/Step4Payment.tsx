/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Onboarding/steps/Step4Payment.tsx
 * Role    : Enable Midtrans or Xendit payment provider. POSTs to onboarding step 4.
 */
import { useState } from 'react';
import { api } from '../../../lib/api';

interface Props { onNext: () => void; onBack: () => void; }

type Provider = 'midtrans' | 'xendit';

export function Step4Payment({ onNext, onBack }: Props) {
  const [selected, setSelected] = useState<Provider | null>(null);
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!selected || !accountId.trim()) {
      setError('Select a provider and enter the key.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/tenants/me/onboarding', {
        step: 4,
        data: { paymentProvider: selected, paymentAccountId: accountId.trim() },
      });
      setSaved(true);
    } catch {
      setError('Failed to save payment settings.');
    } finally {
      setSaving(false);
    }
  }

  const providers: { id: Provider; name: string; desc: string; placeholder: string }[] = [
    { id: 'midtrans', name: 'Midtrans', desc: 'VA + QRIS, popular in Indonesia', placeholder: 'Server Key (SB-...)' },
    { id: 'xendit', name: 'Xendit', desc: 'VA + QR, Southeast Asia', placeholder: 'Secret Key (xnd_production_...)' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Set up payments</h2>
      <p className="text-slate-400 text-sm mb-6">Connect a payment provider to receive orders.</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {providers.map(p => (
          <button
            key={p.id}
            onClick={() => { setSelected(p.id); setAccountId(''); setSaved(false); }}
            className={`text-left p-4 rounded-xl border transition-all ${
              selected === p.id
                ? 'border-indigo-500 bg-indigo-900/20'
                : 'border-[#334155] bg-[#0F172A] hover:border-slate-500'
            }`}
          >
            <div className="font-semibold text-white">{p.name}</div>
            <div className="text-slate-400 text-xs mt-1">{p.desc}</div>
            {saved && selected === p.id && (
              <div className="text-green-400 text-xs mt-2">✓ Connected</div>
            )}
          </button>
        ))}
      </div>

      {selected && !saved && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-300 mb-1">
              {providers.find(p => p.id === selected)?.name} Key
            </label>
            <input
              type="password"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              placeholder={providers.find(p => p.id === selected)?.placeholder}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-sm"
            />
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save & Enable'}
          </button>
        </div>
      )}

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
          ← Back
        </button>
        <button
          onClick={onNext}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          {saved ? 'Next →' : 'Skip for now →'}
        </button>
      </div>
    </div>
  );
}
