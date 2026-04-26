import { useState } from 'react';
import { api } from '../../../lib/api';

export function Step3Products({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [form, setForm] = useState({ name: '', sku: '', priceIdr: '', weightGrams: '', description: '' });
  const [pdfName, setPdfName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleNext() {
    if (!form.name.trim() || !form.priceIdr || !form.weightGrams) { setError('Name, price, and weight are required.'); return; }
    setLoading(true); setError('');
    try {
      await api.post('/products', { name: form.name.trim(), sku: form.sku.trim() || undefined, priceIdr: parseInt(form.priceIdr, 10), weightGrams: parseInt(form.weightGrams, 10), description: form.description.trim() || undefined });
      onNext();
    } catch { setError('Failed to create product. Please try again.'); }
    finally { setLoading(false); }
  }

  const inputCls = 'w-full bg-[#0F172A] border border-[#334155] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500';

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Add your first product</h2>
      <p className="text-slate-400 text-sm mb-6">You can add more products after setup.</p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm text-slate-300 mb-1">Product Name *</label><input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Buku Python Pro" className={inputCls} /></div>
          <div><label className="block text-sm text-slate-300 mb-1">SKU</label><input type="text" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="PYTH-001" className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm text-slate-300 mb-1">Price (IDR) *</label><input type="number" value={form.priceIdr} onChange={e => set('priceIdr', e.target.value)} placeholder="150000" className={inputCls} /></div>
          <div><label className="block text-sm text-slate-300 mb-1">Weight (grams) *</label><input type="number" value={form.weightGrams} onChange={e => set('weightGrams', e.target.value)} placeholder="300" className={inputCls} /></div>
        </div>
        <div><label className="block text-sm text-slate-300 mb-1">Description</label><textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="What makes this product special..." className={`${inputCls} resize-none`} /></div>
        <div>
          <label className="block text-sm text-slate-300 mb-1">Product PDF (optional)</label>
          <label className="flex items-center gap-3 cursor-pointer bg-[#0F172A] border border-dashed border-[#334155] rounded-lg px-4 py-3 hover:border-indigo-500 transition-colors">
            <span className="text-slate-400 text-sm">📎</span><span className="text-slate-400 text-sm">{pdfName || 'Click to upload PDF...'}</span>
            <input type="file" accept=".pdf" className="hidden" onChange={e => setPdfName(e.target.files?.[0]?.name ?? '')} />
          </label>
          <p className="text-slate-500 text-xs mt-1">Used to train the AI product expert.</p>
        </div>
      </div>
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white px-4 py-2 rounded-lg transition-colors">← Back</button>
        <button onClick={handleNext} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors">{loading ? 'Creating...' : 'Next →'}</button>
      </div>
    </div>
  );
}
