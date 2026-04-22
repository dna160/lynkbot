/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Onboarding/steps/Step1StoreName.tsx
 * Role    : Collect store name + origin city. PUTs to /api/v1/tenants/me.
 */
import { useState } from 'react';
import { api } from '../../../lib/api';

interface Props { onNext: () => void; }

export function Step1StoreName({ onNext }: Props) {
  const [storeName, setStoreName] = useState('');
  const [originCityName, setOriginCityName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleNext() {
    if (!storeName.trim() || !originCityName.trim()) {
      setError('Both fields are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.put('/tenants/me', { storeName: storeName.trim(), originCityName: originCityName.trim() });
      onNext();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Tell us about your store</h2>
      <p className="text-slate-400 text-sm mb-6">This will appear in your WhatsApp conversations.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-slate-300 mb-1">Store Name</label>
          <input
            type="text"
            value={storeName}
            onChange={e => setStoreName(e.target.value)}
            placeholder="Toko Buku Nusantara"
            className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-300 mb-1">Shipping Origin City</label>
          <input
            type="text"
            value={originCityName}
            onChange={e => setOriginCityName(e.target.value)}
            placeholder="Jakarta"
            className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <p className="text-slate-500 text-xs mt-1">Used to calculate shipping rates for customers.</p>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      <div className="mt-8 flex justify-end">
        <button
          onClick={handleNext}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          {loading ? 'Saving...' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
